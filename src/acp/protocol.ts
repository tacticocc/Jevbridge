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

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string } }
  | { type: "image"; data: string; mimeType: string };

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export type SessionUpdate =
  | {
      sessionUpdate: "agent_message_chunk";
      content: { type: "text"; text: string };
      messageId?: string;
    }
  | {
      sessionUpdate: "agent_thought_chunk";
      content: { type: "text"; text: string };
    }
  | {
      sessionUpdate: "user_message_chunk";
      content: { type: "text"; text: string };
      messageId?: string;
    }
  | {
      sessionUpdate: "tool_call";
      toolCallId: string;
      title: string;
      name?: string;
      kind?: string;
      status?: ToolCallStatus;
      rawInput?: unknown;
    }
  | {
      sessionUpdate: "tool_call_update";
      toolCallId: string;
      status?: ToolCallStatus;
      title?: string;
      content?: { type: "content"; content: { type: "text"; text: string } }[];
      rawInput?: unknown;
    }
  | {
      sessionUpdate: "plan";
      entries: { content: string; priority: "high" | "medium" | "low"; status: string }[];
    }
  | {
      sessionUpdate: "session_info_update";
      title?: string | null;
      updatedAt?: string | null;
    };

export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export type PermissionOption = {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
};

export type RequestPermissionParams = {
  sessionId: string;
  toolCall: {
    toolCallId: string;
    title?: string;
    name?: string;
    kind?: string;
    status?: string;
    rawInput?: unknown;
  };
  options: PermissionOption[];
};

export type AgentCapabilities = {
  loadSession?: boolean;
  promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
  mcpCapabilities?: { http?: boolean; sse?: boolean };
  sessionCapabilities?: {
    resume?: Record<string, never>;
    list?: Record<string, never>;
    close?: Record<string, never>;
    delete?: Record<string, never>;
    additionalDirectories?: Record<string, never>;
  };
};

export type SessionInfo = {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
  additionalDirectories?: string[];
};

export const PROTOCOL_VERSION = 1;

export const RpcError = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  sessionNotFound: -32002,
} as const;

export function isJsonRpcRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return "method" in msg && typeof msg.method === "string" && "id" in msg && msg.id !== undefined;
}

export function isJsonRpcNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return "method" in msg && typeof msg.method === "string" && !("id" in msg);
}

export function isJsonRpcResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return "id" in msg && msg.id !== undefined && !("method" in msg);
}

export function promptText(blocks: ContentBlock[] | undefined): string {
  if (!blocks) return "";
  return blocks
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "resource") return b.resource.text ?? b.resource.uri;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
