import process from "node:process";
import { evaluate } from "./evaluate.ts";
import { recipeById, RECIPES } from "./recipes.ts";
import { gate } from "./gate.ts";
import { serveAcp } from "./acp/stdio.ts";
import { resolveUpstream } from "./acp/upstream.ts";
import { serveMcp } from "./mcp/stdio.ts";

const HELP = `Jevbridge — ACP + MCP adapter for TypeSafe Jev alongside any LLM

Usage:
  jevbridge mcp                         Speak Model Context Protocol on stdio
  jevbridge acp                         Speak Agent Client Protocol on stdio
  jevbridge acp --upstream claude       Proxy Claude Code ACP and intercept tools
  jevbridge acp --upstream codex        Proxy Codex ACP and intercept tools
  jevbridge acp -- <command> [args...]  Proxy an arbitrary ACP agent
  jevbridge eval <recipe>               Run a built-in recipe (heuristic if no keys)
  jevbridge recipes                     List recipes
  jevbridge help

Env:
  TYPESAFE_API_KEY           Native Jev
  JEVBRIDGE_LLM              xai | openai | anthropic | opencode | codex | generic
  JEVBRIDGE_LLM_MODEL        Override model
  JEVBRIDGE_BASE_URL         Override OpenAI-compatible base URL
  JEVBRIDGE_ACP_UPSTREAM     claude | codex
  JEVBRIDGE_ACP_COMMAND      Custom upstream ACP command
  JEVBRIDGE_ACP_ARGS         Extra args for JEVBRIDGE_ACP_COMMAND
  JEVBRIDGE_SESSION_DIR      Persist ACP sessions (default ~/.jevbridge/sessions)
  JEVBRIDGE_INTERCEPT        Set to 0 to disable tool-call intercept in proxy mode
  XAI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENCODE_API_KEY
`;

async function main() {
  const cmd = process.argv[2] ?? "help";
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (cmd === "recipes") {
    for (const r of RECIPES) process.stdout.write(`${r.id.padEnd(18)} ${r.title} — ${r.blurb}\n`);
    return;
  }
  if (cmd === "eval") {
    const recipe = recipeById(process.argv[3] ?? "support-route");
    const result = await evaluate({
      state: recipe.state,
      questions: recipe.questions,
      backend: "auto",
      jev: process.env.TYPESAFE_API_KEY ? { apiKey: process.env.TYPESAFE_API_KEY } : undefined,
    });
    const g = gate(result.answers);
    process.stdout.write(JSON.stringify({ recipe: recipe.id, ...result, gate: g }, null, 2) + "\n");
    return;
  }
  if (cmd === "acp") {
    await serveAcp({ upstream: resolveUpstream(process.argv.slice(3), process.env) });
    return;
  }
  if (cmd === "mcp") {
    await serveMcp();
    return;
  }
  process.stderr.write(`Unknown command ${cmd}\n\n${HELP}`);
  process.exitCode = 1;
}

void main();
