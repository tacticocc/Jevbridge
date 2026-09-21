import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvaluateResult } from "../types.ts";
import {
  interceptFromGate,
  interceptToolCall,
  selectPermissionOption,
  thoughtForIntercept,
} from "./intercept.ts";

const usage = { input_tokens: 0, output_tokens: 0, latency_ms: 0 };

function result(answers: EvaluateResult["answers"]): EvaluateResult {
  return { backend: "heuristic", model: "test", usage, answers };
}

test("execute gate allows, abort denies, confirm asks", () => {
  assert.equal(interceptFromGate({ action: "execute", reason: "ok", confidence: 0.9 }), "allow");
  assert.equal(interceptFromGate({ action: "abort", reason: "no", confidence: 0.9 }), "deny");
  assert.equal(interceptFromGate({ action: "confirm", reason: "ask", confidence: 0.5 }), "ask");
  assert.equal(interceptFromGate({ action: "escalate", reason: "hmm", confidence: 0.3 }), "ask");
});

test("selectPermissionOption picks allow_once and reject_once", () => {
  const options = [
    { optionId: "allow-once", name: "Allow once", kind: "allow_once" as const },
    { optionId: "reject-once", name: "Reject", kind: "reject_once" as const },
  ];
  assert.equal(selectPermissionOption(options, "allow"), "allow-once");
  assert.equal(selectPermissionOption(options, "deny"), "reject-once");
  assert.equal(selectPermissionOption(options, "ask"), undefined);
});

test("interceptToolCall maps abort answers to deny", async () => {
  const intercepted = await interceptToolCall(
    { tool: { toolCallId: "c1", title: "rm -rf /", kind: "execute" } },
    {
      evaluate: async () =>
        result({
          next: {
            type: "choice",
            choice: "abort",
            confidence: 0.99,
            probabilities: { abort: 0.99, execute: 0.01, confirm: 0 },
          },
          is_destructive: { type: "noul", noul: 1 },
        }),
    },
  );
  assert.equal(intercepted.action, "deny");
  assert.match(thoughtForIntercept(intercepted), /deny/);
});

test("interceptToolCall maps peaked execute to allow unless destructive", async () => {
  const intercepted = await interceptToolCall(
    { tool: { toolCallId: "c2", title: "read file", kind: "read" } },
    {
      evaluate: async () =>
        result({
          next: {
            type: "choice",
            choice: "execute",
            confidence: 0.94,
            probabilities: { execute: 0.94, confirm: 0.04, abort: 0.02 },
          },
          is_destructive: { type: "noul", noul: 0.05 },
        }),
    },
  );
  assert.equal(intercepted.action, "allow");
});
