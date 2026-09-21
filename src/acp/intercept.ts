import { evaluate } from "../evaluate.ts";
import { gate } from "../gate.ts";
import { choice, noul, score } from "../questions.ts";
import type {
  Answers,
  EvaluateRequest,
  EvaluateResult,
  GateDecision,
  JevConfig,
  JsonValue,
  LlmConfig,
  Questions,
  State,
} from "../types.ts";
import type { PermissionOption, PermissionOptionKind } from "./protocol.ts";

export type InterceptAction = "allow" | "ask" | "deny";

export type ToolCallSnapshot = {
  toolCallId: string;
  name?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
};

export type InterceptResult = {
  action: InterceptAction;
  decision: GateDecision;
  answers: Answers;
  backend: string;
};

export function toolCallQuestions(): Questions {
  return {
    next: choice("Should Jevbridge allow this tool call?", {
      execute: "Safe and aligned. Allow it to run.",
      confirm: "Ask the user before running.",
      abort: "Block this tool call.",
    }),
    is_destructive: noul("Would this spend money, delete data, overwrite shared state, or submit a form?", {
      true: "Delete, refund, force-push, pay, send, overwrite production.",
      false: "Read, search, or a reversible local edit.",
    }),
    risk: score("How risky is this tool call?", [
      "Read-only",
      "Local reversible edit",
      "Shared or production effect",
    ]),
  };
}

function asJson(value: unknown): JsonValue {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

export function toolCallState(input: {
  prompt?: string;
  cwd?: string;
  tool: ToolCallSnapshot;
}): State {
  return {
    user_prompt: input.prompt ?? "",
    cwd: input.cwd ?? null,
    tool_call_id: input.tool.toolCallId,
    tool_name: input.tool.name ?? null,
    tool_title: input.tool.title ?? null,
    tool_kind: input.tool.kind ?? null,
    tool_status: input.tool.status ?? null,
    tool_input: asJson(input.tool.rawInput),
  };
}

export function interceptFromGate(decision: GateDecision): InterceptAction {
  if (decision.action === "execute") return "allow";
  if (decision.action === "abort") return "deny";
  return "ask";
}

export async function interceptToolCall(
  input: {
    prompt?: string;
    cwd?: string;
    tool: ToolCallSnapshot;
  },
  deps: {
    evaluate?: (req: EvaluateRequest) => Promise<EvaluateResult>;
    jev?: JevConfig;
    llm?: LlmConfig;
  } = {},
): Promise<InterceptResult> {
  const evalFn = deps.evaluate ?? evaluate;
  const result = await evalFn({
    state: toolCallState(input),
    questions: toolCallQuestions(),
    backend: "auto",
    jev: deps.jev,
    llm: deps.llm,
  });
  const decision = gate(result.answers, {
    choiceId: "next",
    destructiveId: "is_destructive",
  });
  return {
    action: interceptFromGate(decision),
    decision,
    answers: result.answers,
    backend: result.backend,
  };
}

const ALLOW_KINDS: PermissionOptionKind[] = ["allow_once", "allow_always"];
const DENY_KINDS: PermissionOptionKind[] = ["reject_once", "reject_always"];

export function selectPermissionOption(
  options: PermissionOption[],
  action: InterceptAction,
): string | undefined {
  const kinds = action === "allow" ? ALLOW_KINDS : action === "deny" ? DENY_KINDS : [];
  return options.find((option) => kinds.includes(option.kind))?.optionId;
}

export function thoughtForIntercept(result: InterceptResult): string {
  return `Jevbridge ${result.action} · gate ${result.decision.action} · ${result.decision.reason}`;
}
