import { evaluate } from "../evaluate.ts";
import { envJev, envLlm } from "../env.ts";
import { gate, type GatePolicy } from "../gate.ts";
import {
  computerUseQuestions,
  observationState,
  readAction,
  resolveTarget,
} from "../computer-use.ts";
import { parseQuestions } from "../questions.ts";
import { RECIPES } from "../recipes.ts";
import type { Answers, BackendRequest, GateDecision, State } from "../types.ts";
import type { McpTool, McpToolResult } from "./protocol.ts";

const questionItemSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["noul", "choice", "score"] },
    instructions: { type: "string" },
    criteria: {
      description:
        "choice: object of option id → description. score: rubric strings. noul: { true, false } hints.",
    },
  },
  required: ["type", "instructions"],
};

export const MCP_TOOLS: McpTool[] = [
  {
    name: "jev_decide",
    title: "Jev decide",
    description:
      "Run TypeSafe Jev (or the LLM/heuristic System One adapter) on one state. Pass named noul, choice, and score questions. Returns typed answers plus a confidence gate. Use this instead of asking the generating model to classify, route, or pick a next action.",
    inputSchema: {
      type: "object",
      properties: {
        state: {
          description: "Unstructured text or a JSON object describing the current situation.",
        },
        questions: {
          type: "object",
          additionalProperties: questionItemSchema,
          description: "Named System One questions. Keys become answer ids.",
        },
        backend: {
          type: "string",
          enum: ["auto", "jev", "llm", "heuristic"],
          description: "auto uses Jev when TYPESAFE_API_KEY is set, else the LLM adapter, else heuristic.",
        },
        gate: {
          type: "boolean",
          description: "If true (default), also return a confidence gate over the answers.",
        },
        choiceId: { type: "string", description: "Answer id to gate on when multiple choices exist." },
        destructiveId: { type: "string", description: "Noul answer id that marks destructive actions." },
      },
      required: ["state", "questions"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "jev_gate",
    title: "Jev gate",
    description:
      "Confidence-gate already computed System One answers. Returns execute, confirm, escalate, or abort. Call this before a computer-use click, shell command, or any irreversible tool.",
    inputSchema: {
      type: "object",
      properties: {
        answers: {
          type: "object",
          description: "Answers object from jev_decide (noul / choice / score).",
        },
        choiceId: { type: "string" },
        noulId: { type: "string" },
        destructiveId: { type: "string" },
        executeAbove: { type: "number" },
        confirmAbove: { type: "number" },
        abortBelow: { type: "number" },
        abortChoices: { type: "array", items: { type: "string" } },
        doneChoices: { type: "array", items: { type: "string" } },
      },
      required: ["answers"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "jev_computer_use",
    title: "Jev computer use",
    description:
      "Pick the next computer-use action from a closed set: click, type, scroll, wait, screenshot, done, abort. Pass the user goal and visible controls. Returns action, target, safety, and a gate. Do not invent CSS selectors.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        app: { type: "string", description: "Application or surface name." },
        url: { type: "string" },
        visible: {
          type: "array",
          items: { type: "string" },
          description: "Visible control labels, in reading order.",
        },
        focused: { type: "string" },
        lastAction: { type: "string" },
        notes: { type: "string" },
        backend: { type: "string", enum: ["auto", "jev", "llm", "heuristic"] },
      },
      required: ["goal", "visible"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "jev_recipe",
    title: "Jev recipe",
    description:
      "Run a built-in Jevbridge recipe: support-route, computer-use, destructive-gate, or compaction. Useful to see the protocol without assembling questions.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          enum: ["support-route", "computer-use", "destructive-gate", "compaction"],
        },
        backend: { type: "string", enum: ["auto", "jev", "llm", "heuristic"] },
      },
      required: ["id"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

function ok(payload: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function fail(message: string): McpToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function asArgs(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tool arguments must be an object");
  }
  return value as Record<string, unknown>;
}

function backendOf(raw: unknown): BackendRequest {
  if (raw == null || raw === "auto" || raw === "jev" || raw === "llm" || raw === "heuristic") {
    return (raw ?? "auto") as BackendRequest;
  }
  throw new Error("backend must be auto, jev, llm, or heuristic");
}

function asState(raw: unknown): State {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") return raw as State;
  throw new Error("state must be a string or JSON object");
}

function asAnswers(raw: unknown): Answers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("answers must be an object");
  }
  return raw as Answers;
}

function stringArg(raw: unknown, fallback?: string): string | undefined {
  if (raw == null) return fallback;
  if (typeof raw === "string") return raw;
  throw new Error("expected a string");
}

async function runEvaluate(state: State, questions: ReturnType<typeof parseQuestions>, backend: BackendRequest) {
  return evaluate({
    state,
    questions,
    backend,
    jev: envJev(),
    llm: envLlm(),
  });
}

function gated(
  result: Awaited<ReturnType<typeof evaluate>>,
  policy: GatePolicy,
): { answers: Answers; gate: GateDecision; backend: string; model: string; usage: unknown } {
  return {
    backend: result.backend,
    model: result.model,
    usage: result.usage,
    answers: result.answers,
    gate: gate(result.answers, policy),
  };
}

export async function callMcpTool(name: string, rawArgs: unknown): Promise<McpToolResult> {
  try {
    const args = asArgs(rawArgs);
    if (name === "jev_decide") {
      const questions = parseQuestions(args.questions);
      const result = await runEvaluate(asState(args.state), questions, backendOf(args.backend));
      const includeGate = args.gate !== false;
      if (!includeGate) {
        return ok({
          backend: result.backend,
          model: result.model,
          usage: result.usage,
          answers: result.answers,
        });
      }
      return ok(
        gated(result, {
          choiceId: stringArg(args.choiceId),
          destructiveId: stringArg(args.destructiveId),
        }),
      );
    }
    if (name === "jev_gate") {
      const policy: GatePolicy = {
        choiceId: stringArg(args.choiceId),
        noulId: stringArg(args.noulId),
        destructiveId: stringArg(args.destructiveId),
      };
      if (typeof args.executeAbove === "number") policy.executeAbove = args.executeAbove;
      if (typeof args.confirmAbove === "number") policy.confirmAbove = args.confirmAbove;
      if (typeof args.abortBelow === "number") policy.abortBelow = args.abortBelow;
      if (Array.isArray(args.abortChoices)) policy.abortChoices = args.abortChoices as string[];
      if (Array.isArray(args.doneChoices)) policy.doneChoices = args.doneChoices as string[];
      return ok(gate(asAnswers(args.answers), policy));
    }
    if (name === "jev_computer_use") {
      const goal = stringArg(args.goal);
      if (!goal) throw new Error("goal is required");
      if (!Array.isArray(args.visible) || args.visible.some((item) => typeof item !== "string")) {
        throw new Error("visible must be an array of control labels");
      }
      const visible = args.visible as string[];
      const result = await runEvaluate(
        observationState({
          goal,
          app: stringArg(args.app) ?? "desktop",
          url: stringArg(args.url),
          visible,
          focused: stringArg(args.focused) ?? null,
          lastAction: stringArg(args.lastAction) ?? null,
          notes: stringArg(args.notes),
        }),
        computerUseQuestions(visible),
        backendOf(args.backend),
      );
      const decision = gate(result.answers, {
        choiceId: "next_action",
        destructiveId: "is_destructive",
      });
      return ok({
        action: readAction(result.answers),
        target: resolveTarget(result.answers, visible),
        gate: decision,
        backend: result.backend,
        model: result.model,
        answers: result.answers,
      });
    }
    if (name === "jev_recipe") {
      const id = stringArg(args.id);
      if (!id) throw new Error("id is required");
      const found = RECIPES.find((r) => r.id === id);
      if (!found) throw new Error(`unknown recipe: ${id}`);
      const result = await runEvaluate(found.state, found.questions, backendOf(args.backend));
      const choiceId =
        found.id === "computer-use" ? "next_action" : found.id === "destructive-gate" ? "next" : undefined;
      return ok({
        recipe: found.id,
        title: found.title,
        ...gated(result, {
          choiceId,
          destructiveId: "is_destructive" in found.questions ? "is_destructive" : undefined,
        }),
      });
    }
    return fail(`Unknown tool: ${name}`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Tool failed");
  }
}

export const MCP_RESOURCES = [
  {
    uri: "jevbridge://recipes",
    name: "recipes",
    title: "Jevbridge recipes",
    mimeType: "application/json",
    description: "Built-in noul/choice/score recipes.",
  },
  ...RECIPES.map((recipe) => ({
    uri: `jevbridge://recipe/${recipe.id}`,
    name: recipe.id,
    title: recipe.title,
    mimeType: "application/json",
    description: recipe.blurb,
  })),
];

export function readMcpResource(uri: string): { uri: string; mimeType: string; text: string } {
  if (uri === "jevbridge://recipes") {
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        RECIPES.map((r) => ({ id: r.id, title: r.title, blurb: r.blurb })),
        null,
        2,
      ),
    };
  }
  const match = /^jevbridge:\/\/recipe\/([^/]+)$/.exec(uri);
  if (match) {
    const recipe = RECIPES.find((r) => r.id === match[1]);
    if (recipe) {
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(recipe, null, 2),
      };
    }
  }
  throw new Error(`Unknown resource: ${uri}`);
}

export const MCP_PROMPTS = [
  {
    name: "jev_decide",
    title: "Decide with Jev",
    description: "Ask Jevbridge to classify or route instead of the generating model.",
    arguments: [
      { name: "state", description: "Current observation or user request", required: true },
    ],
  },
  {
    name: "jev_computer_use",
    title: "Next computer-use action",
    description: "Ask Jevbridge for the next click/type/scroll given visible controls.",
    arguments: [
      { name: "goal", description: "User goal", required: true },
      { name: "visible", description: "Comma-separated visible controls", required: true },
    ],
  },
];

export function getMcpPrompt(name: string, args: Record<string, unknown> | undefined) {
  if (name === "jev_decide") {
    const state = typeof args?.state === "string" ? args.state : "<paste state>";
    return {
      description: "Call jev_decide on this state.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Call jev_decide. State:\n${state}\n\nAsk noul/choice/score questions. Then jev_gate before acting.`,
          },
        },
      ],
    };
  }
  if (name === "jev_computer_use") {
    const goal = typeof args?.goal === "string" ? args.goal : "<goal>";
    const visible = typeof args?.visible === "string" ? args.visible : "Continue, Cancel";
    return {
      description: "Call jev_computer_use on this observation.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Call jev_computer_use with goal ${JSON.stringify(goal)} and visible controls: ${visible}. Do not invent selectors. Obey the gate.`,
          },
        },
      ],
    };
  }
  throw new Error(`Unknown prompt: ${name}`);
}
