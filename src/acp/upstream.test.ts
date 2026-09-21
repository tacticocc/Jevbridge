import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveUpstream, UPSTREAM_PRESETS } from "./upstream.ts";

test("resolveUpstream reads --upstream claude", () => {
  assert.deepEqual(resolveUpstream(["--upstream", "claude"], {}), UPSTREAM_PRESETS.claude);
});

test("resolveUpstream prefers -- command over --upstream", () => {
  const spec = resolveUpstream(["--upstream", "codex", "--", "my-agent", "--flag"], {});
  assert.deepEqual(spec, { command: "my-agent", args: ["--flag"] });
});

test("resolveUpstream reads env when argv is empty", () => {
  assert.deepEqual(
    resolveUpstream([], { JEVBRIDGE_ACP_UPSTREAM: "codex" }),
    UPSTREAM_PRESETS.codex,
  );
  assert.deepEqual(resolveUpstream([], { JEVBRIDGE_ACP_COMMAND: "bin", JEVBRIDGE_ACP_ARGS: "a b" }), {
    command: "bin",
    args: ["a", "b"],
  });
});

test("resolveUpstream throws on unknown names", () => {
  assert.throws(() => resolveUpstream(["--upstream", "nope"], {}), /Unknown upstream/);
});
