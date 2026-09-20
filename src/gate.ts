import type { Answers, ChoiceAnswer, GateDecision, NoulAnswer, ScoreAnswer } from "./types.ts";

export type GatePolicy = {
  executeAbove?: number;
  confirmAbove?: number;
  abortBelow?: number;
  choiceId?: string;
  noulId?: string;
  destructiveId?: string;
  abortChoices?: string[];
  doneChoices?: string[];
};

const DEFAULT: Required<Omit<GatePolicy, "choiceId" | "noulId" | "destructiveId">> &
  Pick<GatePolicy, "choiceId" | "noulId" | "destructiveId"> = {
  executeAbove: 0.72,
  confirmAbove: 0.46,
  abortBelow: 0.18,
  abortChoices: ["abort", "reject", "unsafe"],
  doneChoices: ["done", "complete"],
};

/** Noul ids treated as a destructiveness signal when `destructiveId` is omitted. */
const DESTRUCTIVE_IDS = ["is_destructive", "destructive"] as const;

/** Independent of how peaked the action distribution is. */
const DESTRUCTIVE_ABOVE = 0.62;

function pickChoice(answers: Answers, id?: string): ChoiceAnswer | undefined {
  if (id && answers[id]?.type === "choice") return answers[id] as ChoiceAnswer;
  return Object.values(answers).find((a): a is ChoiceAnswer => a.type === "choice");
}

function pickNoul(answers: Answers, id?: string): NoulAnswer | undefined {
  if (id && answers[id]?.type === "noul") return answers[id] as NoulAnswer;
  return Object.values(answers).find((a): a is NoulAnswer => a.type === "noul");
}

function pickDestructive(answers: Answers, id?: string): number | undefined {
  if (id) {
    const named = answers[id];
    return named?.type === "noul" ? named.noul : undefined;
  }
  for (const key of DESTRUCTIVE_IDS) {
    const ans = answers[key];
    if (ans?.type === "noul") return ans.noul;
  }
  return undefined;
}

function confidenceOf(answers: Answers, policy: GatePolicy): { value: number; choice?: string } {
  const choice = pickChoice(answers, policy.choiceId);
  if (choice) return { value: choice.confidence, choice: choice.choice };
  const noul = pickNoul(answers, policy.noulId);
  if (noul) return { value: Math.abs(noul.noul - 0.5) * 2 };
  const score = Object.values(answers).find((a): a is ScoreAnswer => a.type === "score");
  if (score) return { value: score.confidence };
  return { value: 0 };
}

export function gate(answers: Answers, policy: GatePolicy = {}): GateDecision {
  const executeAbove = policy.executeAbove ?? DEFAULT.executeAbove;
  const confirmAbove = policy.confirmAbove ?? DEFAULT.confirmAbove;
  const abortBelow = policy.abortBelow ?? DEFAULT.abortBelow;
  const abortChoices = policy.abortChoices ?? DEFAULT.abortChoices;
  const doneChoices = policy.doneChoices ?? DEFAULT.doneChoices;
  const { value: confidence, choice } = confidenceOf(answers, policy);
  const destructive = pickDestructive(answers, policy.destructiveId);

  if (choice && abortChoices.includes(choice)) {
    return { action: "abort", reason: `Jev selected ${choice}.`, confidence, choice, destructive };
  }
  if (choice && doneChoices.includes(choice)) {
    return { action: "execute", reason: "Goal complete.", confidence, choice, destructive };
  }
  if (confidence < abortBelow) {
    return {
      action: "abort",
      reason: "Confidence is too low to act or confirm.",
      confidence,
      choice,
      destructive,
    };
  }
  if (destructive !== undefined && destructive >= DESTRUCTIVE_ABOVE) {
    return {
      action: "confirm",
      reason: "Action looks destructive. Ask before executing.",
      confidence,
      choice,
      destructive,
    };
  }
  if (confidence >= executeAbove) {
    return {
      action: "execute",
      reason: "Distribution is peaked enough to act.",
      confidence,
      choice,
      destructive,
    };
  }
  if (confidence >= confirmAbove) {
    return {
      action: "confirm",
      reason: "Plausible, but not peaked. Request permission.",
      confidence,
      choice,
      destructive,
    };
  }
  return {
    action: "escalate",
    reason: "Hand back to the LLM or a human.",
    confidence,
    choice,
    destructive,
  };
}
