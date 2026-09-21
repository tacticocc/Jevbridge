import assert from "node:assert/strict";
import { test } from "node:test";
import type { JsonRpcMessage } from "./protocol.ts";
import { SessionStore } from "./session-store.ts";
import { AcpSidecar } from "./sidecar.ts";

function sidecar() {
  const sent: JsonRpcMessage[] = [];
  const store = new SessionStore(null);
  const agent = new AcpSidecar((msg) => sent.push(msg), store);
  return { sent, store, agent };
}

test("initialize advertises load, resume, list, close, and delete", async () => {
  const { sent, agent } = sidecar();
  await agent.dispatch({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: 1 },
  });
  const reply = sent[0] as { result: { agentCapabilities: Record<string, unknown> } };
  assert.equal(reply.result.agentCapabilities.loadSession, true);
  const session = reply.result.agentCapabilities.sessionCapabilities as Record<string, unknown>;
  assert.ok(session.resume);
  assert.ok(session.list);
  assert.ok(session.close);
  assert.ok(session.delete);
});

test("session/new, prompt, load replays history; resume does not", async () => {
  const { sent, agent } = sidecar();
  await agent.dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
  await agent.dispatch({
    jsonrpc: "2.0",
    id: 2,
    method: "session/new",
    params: { cwd: "/tmp/proj", mcpServers: [] },
  });
  const created = sent.find((m) => "id" in m && m.id === 2) as { result: { sessionId: string } };
  const sessionId = created.result.sessionId;
  await agent.dispatch({
    jsonrpc: "2.0",
    id: 3,
    method: "session/prompt",
    params: { sessionId, prompt: [{ type: "text", text: "What is 2+2?" }] },
  });
  const afterPrompt = sent.filter((m) => "method" in m && m.method === "session/update").length;
  assert.ok(afterPrompt >= 2);

  sent.length = 0;
  await agent.dispatch({
    jsonrpc: "2.0",
    id: 4,
    method: "session/load",
    params: { sessionId, cwd: "/tmp/proj", mcpServers: [] },
  });
  const loadUpdates = sent.filter((m) => "method" in m && m.method === "session/update");
  assert.ok(loadUpdates.length >= 2);
  const user = loadUpdates.find((m) => {
    const update = (m as { params: { update: { sessionUpdate: string } } }).params.update;
    return update.sessionUpdate === "user_message_chunk";
  });
  assert.ok(user);

  sent.length = 0;
  await agent.dispatch({
    jsonrpc: "2.0",
    id: 5,
    method: "session/resume",
    params: { sessionId, cwd: "/tmp/proj", mcpServers: [] },
  });
  assert.equal(
    sent.filter((m) => "method" in m && m.method === "session/update").length,
    0,
  );
  assert.ok(sent.some((m) => "id" in m && m.id === 5 && "result" in m));
});

test("session/list and session/delete", async () => {
  const { sent, agent } = sidecar();
  await agent.dispatch({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/work", mcpServers: [] } });
  const sessionId = (sent[0] as { result: { sessionId: string } }).result.sessionId;
  sent.length = 0;
  await agent.dispatch({ jsonrpc: "2.0", id: 2, method: "session/list", params: {} });
  const listed = sent[0] as { result: { sessions: { sessionId: string }[] } };
  assert.equal(listed.result.sessions[0].sessionId, sessionId);
  sent.length = 0;
  await agent.dispatch({ jsonrpc: "2.0", id: 3, method: "session/delete", params: { sessionId } });
  sent.length = 0;
  await agent.dispatch({ jsonrpc: "2.0", id: 4, method: "session/load", params: { sessionId, cwd: "/work", mcpServers: [] } });
  const failed = sent[0] as { error: { code: number } };
  assert.equal(failed.error.code, -32002);
});
