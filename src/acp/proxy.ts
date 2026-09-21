import { envJev, envLlm } from "../env.ts";
import { AGENT_NAME, AGENT_TITLE, VERSION } from "../version.ts";
import {
  interceptToolCall,
  selectPermissionOption,
  thoughtForIntercept,
  type InterceptResult,
  type ToolCallSnapshot,
} from "./intercept.ts";
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  promptText,
  RpcError,
  type AgentCapabilities,
  type ContentBlock,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type RequestPermissionParams,
  type SessionUpdate,
} from "./protocol.ts";
import type { SessionStore } from "./session-store.ts";

type PendingClient = {
  clientId: JsonRpcId;
  method: string;
  params?: unknown;
};

type PendingUpstream = {
  upstreamId: JsonRpcId;
};

const DESTRUCTIVE_KINDS = new Set(["execute", "delete", "edit", "move"]);

export function mergeAgentInitialize(upstreamResult: Record<string, unknown>): Record<string, unknown> {
  const caps = { ...((upstreamResult.agentCapabilities as AgentCapabilities | undefined) ?? {}) };
  const sessionCapabilities = { ...(caps.sessionCapabilities ?? {}) };
  caps.loadSession = true;
  caps.sessionCapabilities = {
    ...sessionCapabilities,
    resume: sessionCapabilities.resume ?? {},
    list: sessionCapabilities.list ?? {},
    close: sessionCapabilities.close ?? {},
    delete: sessionCapabilities.delete ?? {},
  };
  const upstreamInfo = (upstreamResult.agentInfo as { name?: string; title?: string } | undefined) ?? {};
  const upstreamLabel = upstreamInfo.title ?? upstreamInfo.name ?? "upstream";
  return {
    ...upstreamResult,
    agentCapabilities: caps,
    agentInfo: {
      name: AGENT_NAME,
      title: `${AGENT_TITLE} (${upstreamLabel})`,
      version: VERSION,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function snapshotFromUnknown(value: unknown): ToolCallSnapshot | undefined {
  const rec = asRecord(value);
  if (typeof rec.toolCallId !== "string") return undefined;
  return {
    toolCallId: rec.toolCallId,
    title: typeof rec.title === "string" ? rec.title : undefined,
    name: typeof rec.name === "string" ? rec.name : undefined,
    kind: typeof rec.kind === "string" ? rec.kind : undefined,
    status: typeof rec.status === "string" ? rec.status : undefined,
    rawInput: rec.rawInput,
  };
}

export type AcpProxyOptions = {
  toClient: (msg: JsonRpcMessage) => void;
  toUpstream: (msg: JsonRpcMessage) => void;
  store: SessionStore;
  intercept?: typeof interceptToolCall;
  interceptEnabled?: boolean;
};

export class AcpProxy {
  private nextId = 1;
  private pendingToUpstream = new Map<number, PendingClient>();
  private pendingToClient = new Map<number, PendingUpstream>();
  private waiters = new Map<number, { resolve: (msg: JsonRpcResponse) => void; reject: (err: Error) => void }>();
  private upstreamCaps: AgentCapabilities = {};
  private lastPrompt = new Map<string, string>();
  private cwdBySession = new Map<string, string>();
  private sessionMap = new Map<string, string>();
  private denied = new Set<string>();
  private readonly interceptEnabled: boolean;
  private readonly intercept: typeof interceptToolCall;
  private readonly jev = envJev();
  private readonly llm = envLlm();
  private readonly opts: AcpProxyOptions;

  constructor(opts: AcpProxyOptions) {
    this.opts = opts;
    this.intercept = opts.intercept ?? interceptToolCall;
    this.interceptEnabled = opts.interceptEnabled ?? process.env.JEVBRIDGE_INTERCEPT !== "0";
  }

  async onClient(msg: JsonRpcMessage): Promise<void> {
    if (isJsonRpcRequest(msg)) {
      if (msg.method === "session/load" && !this.upstreamCaps.loadSession) {
        await this.handleLocalLoad(msg, true);
        return;
      }
      if (msg.method === "session/resume" && !this.upstreamCaps.sessionCapabilities?.resume) {
        await this.handleLocalLoad(msg, false);
        return;
      }
      if (msg.method === "session/list" && !this.upstreamCaps.sessionCapabilities?.list) {
        await this.handleLocalList(msg);
        return;
      }
      if (msg.method === "session/delete") {
        const sessionId = asRecord(msg.params).sessionId;
        if (typeof sessionId === "string") await this.opts.store.delete(sessionId);
        if (!this.upstreamCaps.sessionCapabilities?.delete) {
          this.opts.toClient({ jsonrpc: "2.0", id: msg.id, result: {} });
          return;
        }
      }
      if (msg.method === "session/prompt") {
        const params = asRecord(msg.params);
        const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
        const text = promptText(params.prompt as ContentBlock[] | undefined);
        if (sessionId) {
          this.lastPrompt.set(sessionId, text);
          await this.opts.store.appendUser(sessionId, text);
        }
      }
      this.forwardClientRequest(msg);
      return;
    }
    if (isJsonRpcNotification(msg)) {
      this.opts.toUpstream(this.rewrite(msg, (id) => this.toUpstreamSession(id)));
      return;
    }
    if (isJsonRpcResponse(msg)) {
      const pending = typeof msg.id === "number" ? this.pendingToClient.get(msg.id) : undefined;
      if (!pending) return;
      this.pendingToClient.delete(msg.id as number);
      this.opts.toUpstream({ ...msg, id: pending.upstreamId });
    }
  }

  async onUpstream(msg: JsonRpcMessage): Promise<void> {
    if (isJsonRpcRequest(msg)) {
      if (this.interceptEnabled && msg.method === "session/request_permission") {
        await this.handlePermission(msg);
        return;
      }
      this.forwardUpstreamRequest(msg);
      return;
    }
    if (isJsonRpcNotification(msg)) {
      const rewritten = this.rewrite(msg, (id) => this.toClientSession(id));
      if (isJsonRpcNotification(rewritten) && rewritten.method === "session/update") {
        await this.handleUpdate(rewritten);
      } else {
        this.opts.toClient(rewritten);
      }
      return;
    }
    if (isJsonRpcResponse(msg)) {
      if (typeof msg.id === "number" && this.waiters.has(msg.id)) {
        const waiter = this.waiters.get(msg.id);
        this.waiters.delete(msg.id);
        waiter?.resolve(msg);
        return;
      }
      const pending = typeof msg.id === "number" ? this.pendingToUpstream.get(msg.id) : undefined;
      if (!pending) return;
      this.pendingToUpstream.delete(msg.id as number);
      let result = msg.result;
      if (pending.method === "initialize" && result && typeof result === "object") {
        const merged = mergeAgentInitialize(result as Record<string, unknown>);
        this.upstreamCaps = (merged.agentCapabilities as AgentCapabilities) ?? {};
        result = merged;
      }
      if (pending.method === "session/new" && result && typeof result === "object") {
        const sessionId = (result as { sessionId?: string }).sessionId;
        const params = asRecord(pending.params);
        if (sessionId) {
          this.cwdBySession.set(sessionId, typeof params.cwd === "string" ? params.cwd : "");
          await this.opts.store.create({
            sessionId,
            cwd: typeof params.cwd === "string" ? params.cwd : undefined,
            mcpServers: Array.isArray(params.mcpServers) ? params.mcpServers : undefined,
            additionalDirectories: Array.isArray(params.additionalDirectories)
              ? (params.additionalDirectories as string[])
              : undefined,
          });
        }
      }
      this.opts.toClient({ ...msg, id: pending.clientId, result });
    }
  }

  private toUpstreamSession(sessionId: string): string {
    return this.sessionMap.get(sessionId) ?? sessionId;
  }

  private toClientSession(sessionId: string): string {
    for (const [clientId, upstreamId] of this.sessionMap) {
      if (upstreamId === sessionId) return clientId;
    }
    return sessionId;
  }

  private rewrite(msg: JsonRpcMessage, map: (sessionId: string) => string): JsonRpcMessage {
    if (!("params" in msg)) return msg;
    const params = asRecord(msg.params);
    if (typeof params.sessionId !== "string") return msg;
    return { ...msg, params: { ...params, sessionId: map(params.sessionId) } } as JsonRpcMessage;
  }

  private forwardClientRequest(msg: JsonRpcRequest): void {
    const id = this.nextId++;
    const rewritten = this.rewrite(msg, (sessionId) => this.toUpstreamSession(sessionId)) as JsonRpcRequest;
    this.pendingToUpstream.set(id, { clientId: msg.id, method: msg.method, params: msg.params });
    this.opts.toUpstream({ ...rewritten, id });
  }

  private forwardUpstreamRequest(msg: JsonRpcRequest): void {
    const id = this.nextId++;
    const rewritten = this.rewrite(msg, (sessionId) => this.toClientSession(sessionId)) as JsonRpcRequest;
    this.pendingToClient.set(id, { upstreamId: msg.id });
    this.opts.toClient({ ...rewritten, id });
  }

  private callUpstream(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      this.opts.toUpstream({ jsonrpc: "2.0", id, method, params });
    });
  }

  private async handleLocalLoad(req: JsonRpcRequest, replay: boolean): Promise<void> {
    const params = asRecord(req.params);
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
    if (!sessionId) {
      this.opts.toClient({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: RpcError.invalidParams, message: "sessionId is required" },
      });
      return;
    }
    const stored = await this.opts.store.get(sessionId);
    if (!stored) {
      this.opts.toClient({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: RpcError.sessionNotFound, message: `Session not found: ${sessionId}` },
      });
      return;
    }
    if (typeof params.cwd === "string") stored.cwd = params.cwd;
    await this.opts.store.save(stored);
    this.cwdBySession.set(sessionId, stored.cwd);
    if (this.upstreamCaps.sessionCapabilities?.resume) {
      await this.callUpstream("session/resume", {
        ...params,
        sessionId: this.toUpstreamSession(sessionId),
      });
    } else {
      const created = await this.callUpstream("session/new", {
        cwd: stored.cwd || (typeof params.cwd === "string" ? params.cwd : ""),
        mcpServers: params.mcpServers ?? stored.mcpServers ?? [],
      });
      const newId = asRecord(created.result).sessionId;
      if (typeof newId === "string" && newId !== sessionId) this.sessionMap.set(sessionId, newId);
    }
    if (replay) {
      for (const event of stored.history) {
        if (event.kind === "user") {
          this.opts.toClient({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId,
              update: {
                sessionUpdate: "user_message_chunk",
                content: { type: "text", text: event.text },
              } satisfies SessionUpdate,
            },
          });
        } else {
          this.opts.toClient({
            jsonrpc: "2.0",
            method: "session/update",
            params: { sessionId, update: event.update },
          });
        }
      }
    }
    this.opts.toClient({ jsonrpc: "2.0", id: req.id, result: {} });
  }

  private async handleLocalList(req: JsonRpcRequest): Promise<void> {
    const params = asRecord(req.params);
    const listed = await this.opts.store.list({
      cwd: typeof params.cwd === "string" ? params.cwd : undefined,
      cursor: typeof params.cursor === "string" ? params.cursor : undefined,
    });
    this.opts.toClient({ jsonrpc: "2.0", id: req.id, result: listed });
  }

  private async handlePermission(msg: JsonRpcRequest): Promise<void> {
    const params = msg.params as RequestPermissionParams;
    const tool = snapshotFromUnknown(params.toolCall);
    if (!tool) {
      this.forwardUpstreamRequest(msg);
      return;
    }
    const result = await this.runIntercept(params.sessionId, tool);
    this.emitThought(params.sessionId, result);
    if (result.action === "ask") {
      this.forwardUpstreamRequest(msg);
      return;
    }
    const optionId = selectPermissionOption(params.options ?? [], result.action);
    if (!optionId) {
      this.forwardUpstreamRequest(msg);
      return;
    }
    if (result.action === "deny") this.denied.add(`${params.sessionId}:${tool.toolCallId}`);
    this.opts.toUpstream({
      jsonrpc: "2.0",
      id: msg.id,
      result: { outcome: { outcome: "selected", optionId } },
    });
  }

  private async handleUpdate(msg: JsonRpcMessage): Promise<void> {
    const params = asRecord("params" in msg ? msg.params : undefined);
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
    const update = asRecord(params.update);
    if (sessionId && Object.keys(update).length > 0) {
      await this.opts.store.appendUpdate(sessionId, update);
    }
    const tool = snapshotFromUnknown(update);
    if (sessionId && tool && this.denied.has(`${sessionId}:${tool.toolCallId}`)) {
      return;
    }
    if (
      this.interceptEnabled &&
      sessionId &&
      tool &&
      update.sessionUpdate === "tool_call" &&
      (tool.status === "pending" || tool.status === undefined)
    ) {
      const result = await this.runIntercept(sessionId, tool);
      this.emitThought(sessionId, result);
      if (result.action === "deny") {
        this.denied.add(`${sessionId}:${tool.toolCallId}`);
        this.opts.toClient({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: tool.toolCallId,
              title: tool.title ?? "Blocked tool",
              name: tool.name,
              kind: tool.kind,
              status: "failed",
              rawInput: tool.rawInput,
            } satisfies SessionUpdate,
          },
        });
        this.opts.toClient({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: tool.toolCallId,
              status: "failed",
              content: [
                {
                  type: "content",
                  content: { type: "text", text: thoughtForIntercept(result) },
                },
              ],
            } satisfies SessionUpdate,
          },
        });
        if (tool.kind && DESTRUCTIVE_KINDS.has(tool.kind)) {
          this.opts.toUpstream({
            jsonrpc: "2.0",
            method: "session/cancel",
            params: { sessionId },
          });
        }
        return;
      }
    }
    this.opts.toClient(msg);
  }

  private async runIntercept(sessionId: string, tool: ToolCallSnapshot): Promise<InterceptResult> {
    return this.intercept(
      {
        prompt: this.lastPrompt.get(sessionId),
        cwd: this.cwdBySession.get(sessionId),
        tool,
      },
      { jev: this.jev, llm: this.llm },
    );
  }

  private emitThought(sessionId: string, result: InterceptResult): void {
    this.opts.toClient({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: thoughtForIntercept(result) },
        } satisfies SessionUpdate,
      },
    });
  }
}
