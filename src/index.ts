// @baobox/sdk — thin HTTP client for the BaoBox runtime.
// No business logic here — everything smart lives server-side. This file
// is ~300 lines on purpose; if it grows past ~500, something that belongs
// in the runtime has leaked out.

import { BaoBoxError } from "./errors.js";
import type {
  ChatRequest,
  ChatResponse,
  Event,
  EventListRequest,
  ResponseMeta,
  Session,
  SessionMessage,
  Skill,
  BaoBoxClientOptions,
  SkillUpsertRequest,
  Tool,
  ToolUpsertRequest,
} from "./types.js";

export { BaoBoxError } from "./errors.js";
export type * from "./types.js";

type FetchFn = typeof globalThis.fetch;

export class BaoBoxClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly fetch: FetchFn;
  private readonly timeoutMs: number;

  // `admin` and `events` are pseudo-namespaces — just method bundles so
  // call sites read as `bb.admin.skills.upsert(...)` rather than a flat
  // `bb.upsertSkill(...)`. Matches Tech Arch §4.2.
  public readonly admin: {
    skills: { upsert: (req: SkillUpsertRequest) => Promise<Skill> };
    tools: { upsert: (req: ToolUpsertRequest) => Promise<Tool> };
  };
  public readonly sessions: {
    create: (req: { skillId: string }) => Promise<Session>;
    messages: (sessionId: string) => Promise<SessionMessage[]>;
  };
  public readonly events: {
    list: (req: EventListRequest) => Promise<Event[]>;
  };

  constructor(opts: BaoBoxClientOptions) {
    if (!opts.endpoint) throw new Error("BaoBoxClient: endpoint required");
    if (!opts.apiKey) throw new Error("BaoBoxClient: apiKey required");
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;

    this.admin = {
      skills: {
        upsert: (req) => this.upsertSkill(req),
      },
      tools: {
        upsert: (req) => this.upsertTool(req),
      },
    };
    this.sessions = {
      create: (req) => this.createSession(req),
      messages: (id) => this.listMessages(id),
    };
    this.events = {
      list: (req) => this.listEvents(req),
    };
  }

  // --- Chat (core) ---

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = await this.request<{
      response: string;
      usage: { input_tokens: number; output_tokens: number };
      session_id?: string;
    }>("POST", "/api/v1/chat", {
      skill_id: req.skillId,
      message: req.message,
      session_id: req.sessionId,
      metadata: req.metadata,
    });
    return {
      response: body.data.response,
      usage: {
        inputTokens: body.data.usage.input_tokens,
        outputTokens: body.data.usage.output_tokens,
      },
      sessionId: body.data.session_id,
      meta: body.meta,
    };
  }

  // --- Sessions ---

  private async createSession(req: { skillId: string }): Promise<Session> {
    const body = await this.request<{
      id: string;
      skill_id: string;
      tenant_id: string | null;
      created_at: string;
      updated_at: string;
    }>("POST", "/api/v1/sessions", { skill_id: req.skillId });
    return {
      id: body.data.id,
      skillId: body.data.skill_id,
      tenantId: body.data.tenant_id,
      createdAt: body.data.created_at,
      updatedAt: body.data.updated_at,
    };
  }

  private async listMessages(sessionId: string): Promise<SessionMessage[]> {
    const body = await this.request<
      Array<{
        id: number;
        session_id: string;
        role: "user" | "assistant";
        content: string;
        token_count: number;
        created_at: string;
      }>
    >("GET", `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`);
    return body.data.map((m) => ({
      id: m.id,
      sessionId: m.session_id,
      role: m.role,
      content: m.content,
      tokenCount: m.token_count,
      createdAt: m.created_at,
    }));
  }

  // --- Admin: skills ---

  private async upsertSkill(req: SkillUpsertRequest): Promise<Skill> {
    const body = await this.request<{
      id: string;
      name: string;
      description: string;
      system_prompt: string;
      model: string;
      temperature: number;
      max_tokens: number;
      tenant_id: string | null;
      created_at: string;
      updated_at: string;
    }>("POST", "/api/v1/admin/skills", {
      id: req.id,
      name: req.name,
      description: req.description,
      system_prompt: req.systemPrompt,
      model: req.model,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      tools: req.tools,
    });
    return {
      id: body.data.id,
      name: body.data.name,
      description: body.data.description,
      systemPrompt: body.data.system_prompt,
      model: body.data.model,
      temperature: body.data.temperature,
      maxTokens: body.data.max_tokens,
      tenantId: body.data.tenant_id,
      createdAt: body.data.created_at,
      updatedAt: body.data.updated_at,
    };
  }

  // --- Admin: tools ---

  private async upsertTool(req: ToolUpsertRequest): Promise<Tool> {
    const body = await this.request<{
      id: string;
      name: string;
      description: string;
      input_schema: string;
      handler_type: "builtin" | "http";
      handler_config: string;
      created_at: string;
    }>("POST", "/api/v1/admin/tools", {
      name: req.name,
      description: req.description,
      input_schema: req.inputSchema,
      handler_type: req.handlerType,
      handler_config: req.handlerConfig,
    });
    return {
      id: body.data.id,
      name: body.data.name,
      description: body.data.description,
      inputSchema: body.data.input_schema,
      handlerType: body.data.handler_type,
      handlerConfig: body.data.handler_config,
      createdAt: body.data.created_at,
    };
  }

  // --- Events ---

  private async listEvents(req: EventListRequest): Promise<Event[]> {
    const qs = new URLSearchParams({ session_id: req.sessionId });
    if (req.limit !== undefined) qs.set("limit", String(req.limit));
    if (req.after !== undefined) qs.set("after", req.after);
    const body = await this.request<
      Array<{
        id: string;
        session_id: string;
        request_id: string | null;
        event_type: Event["eventType"];
        content: string | null;
        metadata: string;
        token_count: number;
        latency_ms: number;
        parent_event_id: string | null;
        created_at: string;
      }>
    >("GET", `/api/v1/events?${qs.toString()}`);
    return body.data.map((e) => ({
      id: e.id,
      sessionId: e.session_id,
      requestId: e.request_id,
      eventType: e.event_type,
      content: e.content,
      metadata: safeParseJson(e.metadata) as Record<string, unknown>,
      tokenCount: e.token_count,
      latencyMs: e.latency_ms,
      parentEventId: e.parent_event_id,
      createdAt: e.created_at,
    }));
  }

  // --- core request plumbing ---

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<{ data: T; meta: ResponseMeta }> {
    const url = `${this.endpoint}${path}`;
    const controller = new AbortController();
    const timer =
      this.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : null;

    let res: Response;
    try {
      res = await this.fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const isAbort =
        err instanceof DOMException && err.name === "AbortError";
      throw new BaoBoxError(
        0,
        isAbort ? "TIMEOUT" : "NETWORK",
        isAbort
          ? `Request to ${path} timed out after ${this.timeoutMs}ms`
          : `Network error calling ${path}: ${String(err)}`,
        null,
        null,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    const text = await res.text();
    const parsed = text.length ? safeParseJson(text) : {};

    if (!res.ok) {
      const errObj = (parsed as { error?: { code?: string; message?: string; request_id?: string } }).error;
      throw new BaoBoxError(
        res.status,
        errObj?.code ?? "HTTP_ERROR",
        errObj?.message ?? res.statusText,
        errObj?.request_id ?? null,
        parsed,
      );
    }

    const envelope = parsed as {
      data: T;
      metadata?: {
        request_id: string;
        latency_ms: number;
        model?: string;
        trace?: Array<{
          tool_name: string;
          input: Record<string, unknown>;
          output: unknown;
          latency_ms: number;
        }>;
      };
    };
    return {
      data: envelope.data,
      meta: envelope.metadata
        ? {
            requestId: envelope.metadata.request_id,
            latencyMs: envelope.metadata.latency_ms,
            model: envelope.metadata.model,
            trace: envelope.metadata.trace?.map((t) => ({
              toolName: t.tool_name,
              input: t.input,
              output: t.output,
              latencyMs: t.latency_ms,
            })),
          }
        : { requestId: "", latencyMs: 0 },
    };
  }
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
