import { AGENT_NAME, AGENT_TITLE, VERSION } from "../version.ts";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export const MCP_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export const MCP_PROTOCOL_VERSION = "2025-03-26";

export const SERVER_INFO = {
  name: AGENT_NAME,
  title: AGENT_TITLE,
  version: VERSION,
};

export const SERVER_INSTRUCTIONS =
  "Jevbridge is the System One sidecar. Call jev_decide before routing or acting on a closed set. Call jev_gate before executing a tool, shell command, or GUI click. Call jev_computer_use for the next computer-use action — never let the generating model pick from an open set of DOM selectors. Prefer native Jev when TYPESAFE_API_KEY is set.";

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

export type McpContent = { type: "text"; text: string };

export type McpToolResult = {
  content: McpContent[];
  structuredContent?: unknown;
  isError?: boolean;
};

export function negotiateVersion(requested: unknown): string {
  if (typeof requested === "string" && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested;
  }
  return MCP_PROTOCOL_VERSION;
}
