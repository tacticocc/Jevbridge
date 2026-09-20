import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMcpRequest } from "./stdio.ts";
import { callMcpTool } from "./tools.ts";

test("initialize negotiates a known protocol version", async () => {
  const res = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
  });
  assert.equal(res.error, undefined);
  const result = res.result as { protocolVersion: string; capabilities: { tools: object }; serverInfo: { name: string } };
  assert.equal(result.protocolVersion, "2025-03-26");
  assert.ok(result.capabilities.tools);
  assert.equal(result.serverInfo.name, "jevbridge");
});

test("tools/list exposes decide, gate, computer-use, recipe", async () => {
  const res = await handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = ((res.result as { tools: { name: string }[] }).tools).map((t) => t.name);
  assert.deepEqual(names, ["jev_decide", "jev_gate", "jev_computer_use", "jev_recipe"]);
});

test("jev_decide heuristic routes a refund ticket", async () => {
  const result = await callMcpTool("jev_decide", {
    backend: "heuristic",
    state: "I was charged twice. Refund the duplicate today.",
    questions: {
      refund: { type: "noul", instructions: "Does this request a refund?" },
      team: {
        type: "choice",
        instructions: "Which team?",
        criteria: {
          billing: "Payments, invoices, refunds.",
          technical: "Bugs and outages.",
          other: "None of the above.",
        },
      },
    },
  });
  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as {
    answers: { team: { choice: string }; refund: { noul: number } };
    gate: { action: string };
  };
  assert.equal(payload.answers.team.choice, "billing");
  assert.ok(payload.answers.refund.noul > 0.5);
  assert.ok(payload.gate.action);
});

test("jev_gate aborts a peaked abort choice", async () => {
  const result = await callMcpTool("jev_gate", {
    answers: {
      next_action: {
        type: "choice",
        choice: "abort",
        confidence: 0.96,
        probabilities: { abort: 0.96, click: 0.04 },
      },
    },
    choiceId: "next_action",
  });
  assert.equal((result.structuredContent as { action: string }).action, "abort");
});

test("jev_gate with omitted thresholds executes a peaked safe choice", async () => {
  const result = await callMcpTool("jev_gate", {
    answers: {
      next_action: {
        type: "choice",
        choice: "click",
        confidence: 0.91,
        probabilities: { click: 0.91, abort: 0.09 },
      },
    },
    choiceId: "next_action",
  });
  assert.equal((result.structuredContent as { action: string }).action, "execute");
});

test("jev_gate confirms a peaked destructive click", async () => {
  const result = await callMcpTool("jev_gate", {
    answers: {
      next_action: {
        type: "choice",
        choice: "click",
        confidence: 0.95,
        probabilities: { click: 0.95, abort: 0.05 },
      },
      is_destructive: { type: "noul", noul: 1 },
    },
    choiceId: "next_action",
  });
  const payload = result.structuredContent as { action: string; destructive: number };
  assert.equal(payload.action, "confirm");
  assert.equal(payload.destructive, 1);
});

test("jev_decide gates is_destructive without an explicit destructiveId", async () => {
  const result = await callMcpTool("jev_decide", {
    backend: "heuristic",
    state: {
      proposed_command: "rm -rf ./data/ledger && git push --force origin main",
      user_goal: "Reset local test fixtures",
    },
    questions: {
      next: {
        type: "choice",
        instructions: "What should the agent do?",
        criteria: {
          run: "Safe and aligned — execute.",
          abort: "Refuse. Blast radius is unacceptable.",
        },
      },
      is_destructive: {
        type: "noul",
        instructions: "Is the command destructive or irreversible?",
        criteria: {
          true: "Deletes data, force-pushes, or drops schemas.",
          false: "Read-only or easily reversed.",
        },
      },
    },
  });
  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as {
    gate: { action: string; destructive?: number };
  };
  assert.ok(typeof payload.gate.destructive === "number");
  assert.notEqual(payload.gate.action, "execute");
});

test("jev_computer_use picks click on a refund control", async () => {
  const result = await callMcpTool("jev_computer_use", {
    backend: "heuristic",
    goal: "Refund the duplicate charge on order A-104",
    app: "Billing Console",
    visible: ["Refund duplicate", "Email customer", "Close ticket"],
  });
  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as { action: string; target: string | null };
  assert.equal(payload.action, "click");
  assert.equal(payload.target, "Refund duplicate");
});

test("jev_recipe rejects unknown ids", async () => {
  const result = await callMcpTool("jev_recipe", { id: "nope" });
  assert.equal(result.isError, true);
});

test("unknown method is -32601", async () => {
  const res = await handleMcpRequest({ jsonrpc: "2.0", id: 9, method: "nope" });
  assert.equal(res.error?.code, -32601);
});
