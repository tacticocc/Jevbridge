import { randomUUID } from "node:crypto";
import { evaluate } from "../evaluate.ts";
import { envJev, envLlm } from "../env.ts";
import { gate } from "../gate.ts";
import { computerUseQuestions, observationState, readAction } from "../computer-use.ts";
import { choice, noul, score } from "../questions.ts";
import { AGENT_NAME, AGENT_TITLE, VERSION } from "../version.ts";
import type { EvaluateRequest, State } from "../types.ts";
import type { SessionStore } from "./session-store.ts";
import {
  PROTOCOL_VERSION,
  RpcError,
  promptText,
  type ContentBlock,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type SessionUpdate,
} from "./protocol.ts";

export type AcpSend = (msg: JsonRpcMessage) => void;

type ActiveSession = { cwd?: string; cancelled: boolean };

function looksComputer(text: string): boolean {
  return /click|refund|browser|screen|desktop|computer use|gui/i.test(text);
}

export class AcpSidecar {
  private active = new Map<string, ActiveSession>();
  private readonly jev = envJev();
  private readonly llm = envLlm();
  private readonly send: AcpSend;
  private readonly store: SessionStore;

  constructor(send: AcpSend, store: SessionStore) {
    this.send = send;
    this.store = store;
  }

  async dispatch(msg: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    if (!("id" in msg) || msg.id === undefined) {
      if (msg.method === "session/cancel") {
        const sessionId = (msg.params as { sessionId?: string } | undefined)?.sessionId;
        const active = sessionId ? this.active.get(sessionId) : undefined;
        if (active) active.cancelled = true;
      }
      return;
    }
    const req = msg as JsonRpcRequest;
    try {
      await this.handle(req);
    } catch (err) {
      this.fail(req.id, RpcError.internal, err instanceof Error ? err.message : "Internal error");
    }
  }

  private async handle(req: JsonRpcRequest): Promise<void> {
    switch (req.method) {
      case "initialize":
        this.reply(req.id, {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: false, audio: false, embeddedContext: true },
            sessionCapabilities: {
              resume: {},
              list: {},
              close: {},
              delete: {},
            },
          },
          agentInfo: { name: AGENT_NAME, title: AGENT_TITLE, version: VERSION },
          authMethods: [],
        });
        return;
      case "authenticate":
        this.reply(req.id, {});
        return;
      case "session/new": {
        const params = (req.params ?? {}) as {
          cwd?: string;
          mcpServers?: unknown[];
          additionalDirectories?: string[];
        };
        const sessionId = randomUUID();
        this.active.set(sessionId, { cwd: params.cwd, cancelled: false });
        await this.store.create({
          sessionId,
          cwd: params.cwd,
          mcpServers: params.mcpServers,
          additionalDirectories: params.additionalDirectories,
        });
        this.reply(req.id, { sessionId });
        return;
      }
      case "session/load":
        await this.load(req, true);
        return;
      case "session/resume":
        await this.load(req, false);
        return;
      case "session/list": {
        const params = (req.params ?? {}) as { cwd?: string; cursor?: string };
        const listed = await this.store.list(params);
        this.reply(req.id, listed);
        return;
      }
      case "session/close": {
        const sessionId = this.requireSessionId(req);
        this.active.delete(sessionId);
        this.reply(req.id, {});
        return;
      }
      case "session/delete": {
        const sessionId = this.requireSessionId(req);
        const existed = await this.store.delete(sessionId);
        this.active.delete(sessionId);
        if (!existed) {
          this.fail(req.id, RpcError.sessionNotFound, `Session not found: ${sessionId}`);
          return;
        }
        this.reply(req.id, {});
        return;
      }
      case "session/prompt":
        await this.prompt(req);
        return;
      default:
        this.fail(req.id, RpcError.methodNotFound, `Method not found: ${req.method}`);
    }
  }

  private requireSessionId(req: JsonRpcRequest): string {
    const sessionId = (req.params as { sessionId?: string } | undefined)?.sessionId;
    if (!sessionId) throw new Error("sessionId is required");
    return sessionId;
  }

  private async load(req: JsonRpcRequest, replay: boolean): Promise<void> {
    const params = (req.params ?? {}) as {
      sessionId?: string;
      cwd?: string;
      mcpServers?: unknown[];
      additionalDirectories?: string[];
    };
    if (!params.sessionId) {
      this.fail(req.id, RpcError.invalidParams, "sessionId is required");
      return;
    }
    const stored = await this.store.get(params.sessionId);
    if (!stored) {
      this.fail(req.id, RpcError.sessionNotFound, `Session not found: ${params.sessionId}`);
      return;
    }
    if (params.cwd) stored.cwd = params.cwd;
    if (params.mcpServers) stored.mcpServers = params.mcpServers;
    if (params.additionalDirectories) stored.additionalDirectories = params.additionalDirectories;
    await this.store.save(stored);
    this.active.set(params.sessionId, { cwd: stored.cwd, cancelled: false });
    if (replay) {
      for (const event of stored.history) {
        if (event.kind === "user") {
          this.sendUpdate(params.sessionId, {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: event.text },
          }, false);
        } else {
          this.sendUpdate(params.sessionId, event.update as SessionUpdate, false);
        }
      }
    }
    this.reply(req.id, {});
  }

  private async prompt(req: JsonRpcRequest): Promise<void> {
    const params = req.params as { sessionId: string; prompt: ContentBlock[] };
    if (!params?.sessionId) {
      this.fail(req.id, RpcError.invalidParams, "sessionId is required");
      return;
    }
    let active = this.active.get(params.sessionId);
    const stored = await this.store.get(params.sessionId);
    if (!active) {
      if (!stored) {
        this.fail(req.id, RpcError.sessionNotFound, `Session not found: ${params.sessionId}`);
        return;
      }
      active = { cwd: stored.cwd, cancelled: false };
      this.active.set(params.sessionId, active);
    }
    active.cancelled = false;
    const text = promptText(params.prompt);
    await this.store.appendUser(params.sessionId, text);
    const computer = looksComputer(text);
    const evalReq: EvaluateRequest = {
      state: computer
        ? observationState({
            goal: text,
            app: "editor",
            visible: ["Continue", "Cancel", "Back"],
          })
        : ({ user_prompt: text, cwd: active.cwd ?? stored?.cwd ?? null } as State),
      questions: computer
        ? computerUseQuestions(["Continue", "Cancel", "Back"])
        : {
            task: choice("What is this turn?", {
              question: "Explanation or answer.",
              code_edit: "Change code.",
              computer_use: "Act on a GUI or browser.",
              terminal: "Run a shell command.",
            }),
            needs_permission: noul("Should the agent ask before acting?"),
            risk: score("How risky is an unsupervised action?", [
              "Read-only",
              "Local reversible edit",
              "Shared or production effect",
            ]),
          },
      backend: "auto",
      jev: this.jev,
      llm: this.llm,
    };

    this.sendUpdate(params.sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "jev_decide",
      title: "Jevbridge decide",
      kind: "other",
      status: "in_progress",
    });

    const decision = await evaluate(evalReq);
    const g = gate(decision.answers, {
      choiceId: computer ? "next_action" : "task",
      destructiveId: computer ? "is_destructive" : undefined,
    });

    this.sendUpdate(params.sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "jev_decide",
      status: "completed",
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: JSON.stringify({ answers: decision.answers, gate: g }, null, 2),
          },
        },
      ],
    });

    const line = computer
      ? `Next action ${readAction(decision.answers)} · gate ${g.action} · ${g.reason}`
      : `Task routed · gate ${g.action} · ${g.reason}`;

    this.sendUpdate(params.sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: line },
    });

    this.reply(req.id, { stopReason: active.cancelled ? "cancelled" : "end_turn" });
  }

  private sendUpdate(sessionId: string, update: SessionUpdate, persist = true): void {
    this.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId, update },
    });
    if (persist) void this.store.appendUpdate(sessionId, update as unknown as Record<string, unknown>);
  }

  private reply(id: JsonRpcId, result: unknown): void {
    this.send({ jsonrpc: "2.0", id, result });
  }

  private fail(id: JsonRpcId, code: number, message: string): void {
    this.send({ jsonrpc: "2.0", id, error: { code, message } });
  }
}
