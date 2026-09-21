import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvaluateResult } from "../types.ts";
import { interceptToolCall } from "./intercept.ts";
import type { JsonRpcMessage } from "./protocol.ts";
import { AcpProxy, mergeAgentInitialize } from "./proxy.ts";
import { SessionStore } from "./session-store.ts";

const usage = { input_tokens: 0, output_tokens: 0, latency_ms: 0 };

function answers(choice: "execute" | "confirm" | "abort", destructive = 0.1): EvaluateResult {
  return {
    backend: "heuristic",
    model: "test",
    usage,
    answers: {
      next: {
        type: "choice",
        choice,
        confidence: 0.95,
        probabilities: { [choice]: 0.95 },
      },
      is_destructive: { type: "noul", noul: destructive },
    },
  };
}

function interceptWith(choice: "execute" | "confirm" | "abort", destructive = 0.1) {
  return (input: Parameters<typeof interceptToolCall>[0]) =>
    interceptToolCall(input, { evaluate: async () => answers(choice, destructive) });
}

function proxy(interceptChoice: "execute" | "confirm" | "abort" = "execute", destructive = 0.1) {
  const toClient: JsonRpcMessage[] = [];
  const toUpstream: JsonRpcMessage[] = [];
  const store = new SessionStore(null);
  const agent = new AcpProxy({
    toClient: (msg) => toClient.push(msg),
    toUpstream: (msg) => toUpstream.push(msg),
    store,
    intercept: interceptWith(interceptChoice, destructive),
  });
  return { toClient, toUpstream, store, agent };
}

test("mergeAgentInitialize advertises load and resume on top of upstream caps", () => {
  const merged = mergeAgentInitialize({
    protocolVersion: 1,
    agentCapabilities: { promptCapabilities: { image: true } },
    agentInfo: { name: "codex-acp", title: "Codex" },
  });
  const caps = merged.agentCapabilities as {
    loadSession: boolean;
    sessionCapabilities: { resume: object; list: object };
  };
  assert.equal(caps.loadSession, true);
  assert.ok(caps.sessionCapabilities.resume);
  assert.ok(caps.sessionCapabilities.list);
  assert.equal((merged.agentInfo as { title: string }).title, "Jevbridge (Codex)");
});

test("initialize response is merged before it reaches the client", async () => {
  const { toClient, toUpstream, agent } = proxy();
  await agent.onClient({
    jsonrpc: "2.0",
    id: "c-init",
    method: "initialize",
    params: { protocolVersion: 1 },
  });
  const forwarded = toUpstream[0] as { id: number; method: string };
  assert.equal(forwarded.method, "initialize");
  await agent.onUpstream({
    jsonrpc: "2.0",
    id: forwarded.id,
    result: {
      protocolVersion: 1,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: "claude-agent-acp", title: "Claude Code" },
    },
  });
  const reply = toClient[0] as { id: string; result: { agentCapabilities: { loadSession: boolean } } };
  assert.equal(reply.id, "c-init");
  assert.equal(reply.result.agentCapabilities.loadSession, true);
});

test("permission allow auto-selects allow_once and does not ask the host", async () => {
  const { toClient, toUpstream, agent } = proxy("execute");
  await agent.onUpstream({
    jsonrpc: "2.0",
    id: 9,
    method: "session/request_permission",
    params: {
      sessionId: "s1",
      toolCall: { toolCallId: "t1", title: "Read README", kind: "read" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    },
  });
  const reply = toUpstream.find((m) => "id" in m && m.id === 9) as {
    result: { outcome: { optionId: string } };
  };
  assert.equal(reply.result.outcome.optionId, "allow-once");
  assert.equal(
    toClient.filter((m) => "method" in m && m.method === "session/request_permission").length,
    0,
  );
  assert.ok(toClient.some((m) => "method" in m && m.method === "session/update"));
});

test("permission deny auto-selects reject_once", async () => {
  const { toUpstream, agent } = proxy("abort", 1);
  await agent.onUpstream({
    jsonrpc: "2.0",
    id: 10,
    method: "session/request_permission",
    params: {
      sessionId: "s1",
      toolCall: { toolCallId: "t2", title: "rm -rf /", kind: "execute" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    },
  });
  const reply = toUpstream.find((m) => "id" in m && m.id === 10) as {
    result: { outcome: { optionId: string } };
  };
  assert.equal(reply.result.outcome.optionId, "reject-once");
});

test("permission confirm is forwarded to the host", async () => {
  const { toClient, toUpstream, agent } = proxy("confirm", 0.8);
  await agent.onUpstream({
    jsonrpc: "2.0",
    id: 11,
    method: "session/request_permission",
    params: {
      sessionId: "s1",
      toolCall: { toolCallId: "t3", title: "Write file", kind: "edit" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    },
  });
  assert.equal(toUpstream.length, 0);
  const forwarded = toClient.find((m) => "method" in m && m.method === "session/request_permission") as {
    id: number;
  };
  assert.ok(forwarded);
  await agent.onClient({
    jsonrpc: "2.0",
    id: forwarded.id,
    result: { outcome: { outcome: "selected", optionId: "allow-once" } },
  });
  const back = toUpstream[0] as { id: number; result: { outcome: { optionId: string } } };
  assert.equal(back.id, 11);
  assert.equal(back.result.outcome.optionId, "allow-once");
});

test("denied pending execute tool_call is failed and cancelled", async () => {
  const { toClient, toUpstream, agent } = proxy("abort", 1);
  await agent.onUpstream({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t4",
        title: "rm -rf src",
        kind: "execute",
        status: "pending",
      },
    },
  });
  assert.ok(
    toClient.some((m) => {
      const update = (m as { params?: { update?: { status?: string } } }).params?.update;
      return update?.status === "failed";
    }),
  );
  assert.ok(toUpstream.some((m) => "method" in m && m.method === "session/cancel"));
});

test("session/new is stored so sidecar-style list works without upstream list", async () => {
  const { toClient, toUpstream, store, agent } = proxy();
  await agent.onClient({
    jsonrpc: "2.0",
    id: 1,
    method: "session/new",
    params: { cwd: "/repo", mcpServers: [] },
  });
  const forwarded = toUpstream[0] as { id: number };
  await agent.onUpstream({
    jsonrpc: "2.0",
    id: forwarded.id,
    result: { sessionId: "up-sess" },
  });
  const created = await store.get("up-sess");
  assert.equal(created?.cwd, "/repo");
  toClient.length = 0;
  await agent.onClient({ jsonrpc: "2.0", id: 2, method: "session/list", params: {} });
  const listed = toClient[0] as { result: { sessions: { sessionId: string }[] } };
  assert.equal(listed.result.sessions[0].sessionId, "up-sess");
});
