export type UpstreamSpec = {
  name?: string;
  command: string;
  args: string[];
};

export const UPSTREAM_PRESETS: Record<string, UpstreamSpec> = {
  claude: {
    name: "claude",
    command: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp"],
  },
  "claude-code": {
    name: "claude",
    command: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp"],
  },
  codex: {
    name: "codex",
    command: "npx",
    args: ["-y", "@agentclientprotocol/codex-acp"],
  },
};

export function resolveUpstream(argv: string[], env: NodeJS.ProcessEnv = process.env): UpstreamSpec | undefined {
  const dash = argv.indexOf("--");
  if (dash >= 0) {
    const command = argv[dash + 1];
    if (!command) throw new Error("acp -- requires a command");
    return { command, args: argv.slice(dash + 2) };
  }
  const upIdx = argv.indexOf("--upstream");
  if (upIdx >= 0) {
    const name = argv[upIdx + 1];
    if (!name) throw new Error("acp --upstream requires claude or codex");
    return preset(name);
  }
  if (env.JEVBRIDGE_ACP_COMMAND) {
    const extra = (env.JEVBRIDGE_ACP_ARGS ?? "").split(/\s+/).filter(Boolean);
    return { command: env.JEVBRIDGE_ACP_COMMAND, args: extra };
  }
  if (env.JEVBRIDGE_ACP_UPSTREAM) return preset(env.JEVBRIDGE_ACP_UPSTREAM);
  return undefined;
}

function preset(name: string): UpstreamSpec {
  const found = UPSTREAM_PRESETS[name.toLowerCase()];
  if (!found) {
    throw new Error(`Unknown upstream ${name}. Use claude, codex, or -- <command>`);
  }
  return { name: found.name, command: found.command, args: [...found.args] };
}

export function spawnCommand(command: string): string {
  if (process.platform !== "win32") return command;
  if (command === "npx" || command === "npm" || command === "node") return `${command}.cmd`;
  return command;
}
