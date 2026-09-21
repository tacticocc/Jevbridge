---
name: jevbridge
description: >
  Use TypeSafe Jev (or any LLM as a System One adapter) for typed decisions
  alongside a generating model. Triggers on routing, gating, scoring, computer
  use next-action, MCP, ACP, Codex, Claude, Grok, OpenCode, noul/choice/score.
---

# Jevbridge

Do not ask a generating LLM to classify, route, or pick a GUI click when a System One call will do.

## When to call Jevbridge

- Closed sets: department, next tool, next computer-use action
- Yes/no gates: is this destructive, does this match the goal
- Rubrics: urgency, blast radius, goal progress
- Fan-out: many independent questions on one state

## Protocol

```ts
import { evaluate, gate, noul, choice, score } from "../../src/index.ts";

const result = await evaluate({
  state,
  questions: {
    ok: noul("Is this safe to run unsupervised?"),
    next: choice("What next?", { run: null, ask: null, abort: null }),
  },
  backend: "auto",
});
const g = gate(result.answers, { choiceId: "next" });
```

Backends: `jev` (TypeSafe), `llm` (Codex / Claude / Grok / OpenCode / generic), `heuristic` (offline), `auto`.

## Computer use

Use `computerUseQuestions(visibleControls)` and `observationState({ goal, app, visible })`.
Never let the generator pick from an open set of DOM selectors. Jev returns `click | type | scroll | wait | screenshot | done | abort`.

## MCP

`node --experimental-strip-types src/cli.ts mcp` speaks Model Context Protocol on stdio (newline-delimited JSON-RPC). Point Claude Desktop, Cursor, Codex, or OpenCode at it.

Tools:

- `jev_decide` — noul / choice / score on one state
- `jev_gate` — execute / confirm / escalate / abort
- `jev_computer_use` — next GUI action from a closed set
- `jev_recipe` — run `support-route`, `computer-use`, `destructive-gate`, or `compaction`

See `examples/claude-desktop.json`, `examples/cursor.mcp.json`, `examples/codex.config.toml`, `examples/opencode.json`.

## ACP

`node --experimental-strip-types src/cli.ts acp` speaks Agent Client Protocol on stdio. Point Zed / JetBrains `agent_servers` at it.

- Sidecar mode decides the turn with Jev and persists sessions (`session/load`, `session/resume`, `session/list`).
- Proxy mode: `jevbridge acp --upstream claude` or `--upstream codex`. Forwards the generating ACP agent and intercepts tool calls (`allow` / `ask` / `deny`).

The generating agent stays the LLM; Jevbridge is the decision sidecar.
