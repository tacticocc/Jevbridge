import assert from "node:assert/strict";
import { test } from "node:test";
import { gate } from "./gate.ts";
import type { Answers } from "./types.ts";

test("peaked safe choice executes", () => {
  const answers: Answers = {
    next_action: {
      type: "choice",
      choice: "click",
      confidence: 0.91,
      probabilities: { click: 0.91, abort: 0.09 },
    },
  };
  assert.equal(gate(answers, { choiceId: "next_action" }).action, "execute");
});

test("destructive mid-confidence confirms", () => {
  const answers: Answers = {
    next_action: {
      type: "choice",
      choice: "click",
      confidence: 0.7,
      probabilities: { click: 0.7, abort: 0.3 },
    },
    is_destructive: { type: "noul", noul: 0.84 },
  };
  assert.equal(
    gate(answers, { choiceId: "next_action", destructiveId: "is_destructive" }).action,
    "confirm",
  );
});

test("abort choice aborts", () => {
  const answers: Answers = {
    next_action: {
      type: "choice",
      choice: "abort",
      confidence: 0.95,
      probabilities: { abort: 0.95, click: 0.05 },
    },
  };
  assert.equal(gate(answers, { choiceId: "next_action" }).action, "abort");
});

test("noul without destructiveId is not treated as destructive", () => {
  const answers: Answers = {
    refund: { type: "noul", noul: 0.95 },
    team: {
      type: "choice",
      choice: "billing",
      confidence: 0.8,
      probabilities: { billing: 0.8, other: 0.2 },
    },
  };
  const decision = gate(answers);
  assert.equal(decision.destructive, undefined);
  assert.equal(decision.action, "execute");
});

test("explicit undefined thresholds keep defaults so a peaked choice executes", () => {
  const answers: Answers = {
    next_action: {
      type: "choice",
      choice: "click",
      confidence: 0.91,
      probabilities: { click: 0.91, abort: 0.09 },
    },
  };
  assert.equal(
    gate(answers, {
      choiceId: "next_action",
      executeAbove: undefined,
      confirmAbove: undefined,
      abortBelow: undefined,
    }).action,
    "execute",
  );
});

test("high-confidence destructive action confirms", () => {
  const answers: Answers = {
    next_action: {
      type: "choice",
      choice: "click",
      confidence: 0.95,
      probabilities: { click: 0.95, abort: 0.05 },
    },
    is_destructive: { type: "noul", noul: 1 },
  };
  assert.equal(
    gate(answers, { choiceId: "next_action", destructiveId: "is_destructive" }).action,
    "confirm",
  );
});

test("is_destructive noul is gated even without destructiveId", () => {
  const answers: Answers = {
    next_action: {
      type: "choice",
      choice: "click",
      confidence: 0.95,
      probabilities: { click: 0.95, abort: 0.05 },
    },
    is_destructive: { type: "noul", noul: 1 },
  };
  const decision = gate(answers, { choiceId: "next_action" });
  assert.equal(decision.action, "confirm");
  assert.equal(decision.destructive, 1);
});
