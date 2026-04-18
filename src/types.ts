// Request/response shapes sent over the wire. Kept intentionally minimal —
// Phase 1 covers the fields both the backend and the demo UI actually use.
// Adding a field later is a non-breaking change; removing one is breaking.

export type BaoBoxClientOptions = {
  /** Full URL to the BaoBox worker, e.g. "https://baobox-jv1.brightq.workers.dev" */
  endpoint: string;
  /** API key issued by BaoBox admin. Hashes to one `api_keys` row. */
  apiKey: string;
  /** Optional tag for observability — not sent over the wire yet. */
  orgId?: string;
  /**
   * Optional `fetch` override. Use this in tests to inject a mock, or in
   * edge runtimes that ship a non-global fetch (old Node, workerd variants).
   * Defaults to globalThis.fetch.
   */
  fetch?: typeof globalThis.fetch;
  /** Request timeout in ms. Default 30 000. Set to 0 to disable. */
  timeoutMs?: number;
};

// --- Chat ---

export type ChatRequest = {
  skillId: string;
  message: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

export type ChatResponse = {
  response: string;
  usage: { inputTokens: number; outputTokens: number };
  sessionId?: string;
  /** Full BaoBox metadata envelope: request_id, latency, tool trace. */
  meta: ResponseMeta;
};

export type ResponseMeta = {
  requestId: string;
  latencyMs: number;
  model?: string;
  trace?: ToolTrace[];
};

export type ToolTrace = {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  latencyMs: number;
};

// --- Sessions ---

export type Session = {
  id: string;
  skillId: string;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionMessage = {
  id: number;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  tokenCount: number;
  createdAt: string;
};

// --- Admin: skills ---

export type SkillUpsertRequest = {
  id?: string;
  name: string;
  description?: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
};

export type Skill = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
};

// --- Admin: tools ---

export type ToolUpsertRequest = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handlerType: "builtin" | "http";
  handlerConfig: Record<string, unknown>;
};

export type Tool = {
  id: string;
  name: string;
  description: string;
  inputSchema: string;
  handlerType: "builtin" | "http";
  handlerConfig: string;
  createdAt: string;
};

// --- Events ---

export type EventType =
  | "user_message"
  | "assistant_message"
  | "system_message"
  | "llm_call_start"
  | "llm_call_end"
  | "tool_call"
  | "tool_result"
  | "error";

export type Event = {
  id: string;
  sessionId: string;
  requestId: string | null;
  eventType: EventType;
  content: string | null;
  metadata: Record<string, unknown>;
  tokenCount: number;
  latencyMs: number;
  parentEventId: string | null;
  createdAt: string;
};

export type EventListRequest = {
  sessionId: string;
  limit?: number;
  after?: string;
};
