import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionStore, titleFromPrompt } from "./session-store.ts";

test("titleFromPrompt uses the first non-empty line", () => {
  assert.equal(titleFromPrompt("\n  Refund the duplicate  \nmore"), "Refund the duplicate");
});

test("memory store creates, lists, loads, and deletes", async () => {
  const store = new SessionStore(null);
  const created = await store.create({ sessionId: "sess_1", cwd: "/tmp/proj" });
  await store.appendUser("sess_1", "hello");
  await store.appendUpdate("sess_1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } });
  const got = await store.get("sess_1");
  assert.equal(got?.cwd, "/tmp/proj");
  assert.equal(got?.title, "hello");
  assert.equal(got?.history.length, 2);
  const listed = await store.list({ cwd: "/tmp/proj" });
  assert.equal(listed.sessions.length, 1);
  assert.equal(listed.sessions[0].sessionId, created.sessionId);
  assert.equal(await store.delete("sess_1"), true);
  assert.equal(await store.get("sess_1"), undefined);
});

test("disk store round-trips a session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jevbridge-sessions-"));
  try {
    const store = new SessionStore(dir);
    await store.create({ sessionId: "sess_disk", cwd: "/work" });
    await store.appendUser("sess_disk", "resume me");
    const other = new SessionStore(dir);
    const got = await other.get("sess_disk");
    assert.equal(got?.title, "resume me");
    assert.equal(got?.history[0]?.kind, "user");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
