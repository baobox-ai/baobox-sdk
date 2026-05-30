import { BaoBoxError } from "./errors.js";
import { MAX_INLINE_BYTES } from "./types.js";
import type {
  AdminStats,
  ApiKey,
  AppendedRunEvent,
  AppendRunEventRequest,
  AttachmentInput,
  AttachmentInputBaoboxRef,
  AttachmentInputInline,
  AttachmentInputUrl,
  ParseStrategy,
  AttachToolResult,
  BaoBoxClientOptions,
  CallerPushedEventType,
  CallLogRow,
  ChatRequest,
  ChatResponse,
  ChatStreamRequest,
  SseEvent,
  CreateApiKeyRequest,
  CreateEvalCaseRequest,
  CreateScheduledTaskRequest,
  DeleteResult,
  DetachToolResult,
  EvalCase,
  EvalCompare,
  EvalCompareRequest,
  EvalFailureRow,
  EvalFailuresRequest,
  EvalRunExecution,
  EvalRunResult,
  EvalRunResultSummary,
  EvalRunWithResults,
  EvalStats,
  EvalStatsRequest,
  Event,
  EventListRequest,
  HealthResponse,
  JsonObject,
  ResponseMeta,
  RunEvalRequest,
  ScheduledTask,
  Session,
  SessionCreateRequest,
  SessionMessage,
  SessionTimeline,
  SetSkillFileRequest,
  SetSkillFileResult,
  SetSkillSecretRequest,
  SetSkillSecretResult,
  Skill,
  SkillCreateRequest,
  SkillFile,
  SkillFileReference,
  SkillFileSummary,
  SkillImportRequest,
  SkillSecretSummary,
  SkillUpdateRequest,
  SkillUpsertRequest,
  SkillWithFiles,
  Tool,
  ToolCreateRequest,
  ToolInvokeRequest,
  ToolInvokeResponse,
  ToolUpsertRequest,
  UpdateScheduledTaskRequest,
  CreatedApiKey,
  WorkflowRequest,
  WorkflowResponse,
  WorkflowRunListRequest,
  WorkflowRunSummary,
  WorkflowRunTimeline,
} from "./types.js";

export { BaoBoxError } from "./errors.js";
export { MAX_INLINE_BYTES } from "./types.js";
export type * from "./types.js";

type FetchFn = typeof globalThis.fetch;
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type AuthMode = "none" | "apiKey" | "adminSecret";

type ApiEnvelope<T> = {
  data: T;
  meta: ResponseMeta;
};

// 0.8.0: every renamed field on the public-SDK wire (request/latency/trace)
// arrives in BOTH shapes during the Phase-1 deprecation window and in
// camelCase ONLY after Phase 3. Keep both optional so a single Raw* type
// covers every server contract revision the SDK has to parse.
type RawMetadata = {
  requestId?: string;
  request_id?: string;
  latencyMs?: number;
  latency_ms?: number;
  model?: string;
  trace?: Array<{
    toolName?: string;
    tool_name?: string;
    input: JsonObject;
    output: unknown;
    latencyMs?: number;
    latency_ms?: number;
  }>;
};

// 0.8.0 admin surface (#142 sibling fix): every admin route now emits
// camelCase fields and renames the entity primary key (`id` → `skillId`,
// `toolId`, `evalCaseId`, etc.). The mappers below read those camelCase
// fields and translate to the domain types (which keep the shorter `id`
// shape for ergonomics). This was previously snake_case in 0.7.x and
// silently broke every admin caller when the BaoBox server shipped its
// camelCase epic without a coordinated SDK release.
type RawSession = {
  sessionId: string;
  skillId: string;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
};

type RawSessionMessage = {
  messageId: number;
  sessionId: string;
  role: SessionMessage["role"];
  content: string;
  tokenCount: number;
  createdAt: string;
};

type RawEvent = {
  eventId: string;
  sessionId: string | null;
  requestId: string | null;
  runId?: string | null;
  eventType: Event["eventType"];
  content: string | null;
  metadata: unknown;
  tokenCount: number;
  latencyMs: number;
  parentEventId: string | null;
  createdAt: string;
};

type RawSkill = {
  skillId: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  sourceUrl: string | null;
  tenantId: string | null;
  // η.1 / B-3 — per-skill attachment policy. Optional on the SDK side so a
  // pre-η.1 server (which omits the fields) doesn't break the mapper.
  attachmentDefault?: string;
  attachmentMaxCount?: number;
  attachmentMaxSizeMb?: number;
  fileLoadMode?: string;
  createdAt: string;
  updatedAt: string;
};

type RawSkillWithFiles = RawSkill & {
  files: Array<{
    path: string;
    size: number;
  }>;
};

type RawSkillFileSummary = {
  path: string;
  size: number;
  updatedAt: string;
};

type RawSkillFile = {
  skillFileId: string;
  skillId: string;
  path: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type RawTool = {
  toolId: string;
  name: string;
  description: string;
  inputSchema: string;
  handlerType: Tool["handlerType"];
  handlerConfig: string;
  emitSchemaRef?: string | null;
  createdAt: string;
};

type RawSkillSecretSummary = {
  skillSecretId: string;
  key: string;
  createdAt: string;
};

type RawApiKey = {
  apiKeyId: string;
  name: string;
  permissions: string;
  rateLimit: number;
  tenantId: string | null;
  createdAt: string;
  expiresAt: string | null;
};

type RawCreatedApiKey = {
  apiKeyId: string;
  key: string;
  name: string;
  tenantId: string;
};

type RawScheduledTask = {
  taskId: string;
  name: string;
  skillId: string;
  prompt: string;
  telegramChatId: number | null;
  schedule: string;
  enabled: number;
  createdAt: string;
  lastRunAt: string | null;
};

type RawEvalCase = {
  evalCaseId: string;
  skillId: string;
  name: string;
  input: string;
  expectedBehavior: string;
  dimensions: string;
  passingThreshold: number;
  createdAt: string;
  updatedAt: string;
};

type RawEvalRunExecution = {
  evalRunId: string;
  status: string;
  totalCases: number;
  passed: number;
  failed: number;
  avgScore: number | null;
  results: Array<{
    evalCaseId: string;
    status: string;
    score: number | null;
    scores: unknown;
    response: string | null;
    reasoning: string | null;
  }>;
  durationMs: number;
};

type RawEvalRun = {
  evalRunId: string;
  skillId: string;
  promptVersion: string | null;
  status: string;
  totalCases: number;
  passed: number;
  failed: number;
  avgScore: number | null;
  metadata: string;
  createdAt: string;
  completedAt: string | null;
};

type RawEvalRunResult = {
  evalRunResultId: string;
  evalRunId: string;
  evalCaseId: string;
  sessionId: string | null;
  status: string;
  score: number | null;
  scoresJson: string | null;
  response: string | null;
  reasoning: string | null;
  latencyMs: number;
  /** Added in BaoBox migration 0018; older backends omit it. */
  llmInputJson?: string | null;
  createdAt: string;
};

type RawEvalStats = {
  skillId: string;
  period: { since: string };
  summary:
    | {
        total: number;
        avgScore: number;
        distribution: Record<string, number>;
      }
    | null;
  trend: Record<string, unknown>[];
};

type RawWorkflowRunSummary = {
  callLogId: string;
  requestId: string;
  runId: string | null;
  skillId: string | null;
  clientId: string | null;
  externalRequestId: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  toolCallsCount: number;
  status: string;
  errorCode: string | null;
  createdAt: string;
};

type RawWorkflowRunTimeline = {
  runId: string;
  events: RawEvent[];
};

type RawAppendedRunEvent = {
  eventId: string;
  runId: string;
  eventType: CallerPushedEventType;
};

type RawEvalCompare = {
  skillId: string;
  versionA: {
    label: string;
    dimensions: Record<string, unknown>[];
  };
  versionB: {
    label: string;
    dimensions: Record<string, unknown>[];
  };
};

export class BaoBoxClient {
  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly adminSecret: string | null;
  private readonly fetch: FetchFn;
  private readonly timeoutMs: number;

  public readonly health: {
    get: () => Promise<HealthResponse>;
  };
  public readonly admin: {
    keys: {
      list: () => Promise<ApiKey[]>;
      create: (req: CreateApiKeyRequest) => Promise<CreatedApiKey>;
      delete: (id: string) => Promise<DeleteResult>;
    };
    stats: {
      get: (req?: { since?: string }) => Promise<AdminStats>;
    };
    logs: {
      list: (req?: { limit?: number }) => Promise<CallLogRow[]>;
    };
    tasks: {
      list: () => Promise<ScheduledTask[]>;
      create: (req: CreateScheduledTaskRequest) => Promise<ScheduledTask | null>;
      update: (id: string, req: UpdateScheduledTaskRequest) => Promise<ScheduledTask | null>;
      delete: (id: string) => Promise<DeleteResult>;
    };
    skills: {
      upsert: (req: SkillUpsertRequest) => Promise<Skill>;
    };
    tools: {
      upsert: (req: ToolUpsertRequest) => Promise<Tool>;
    };
  };
  public readonly sessions: {
    create: (req?: SessionCreateRequest) => Promise<Session>;
    get: (sessionId: string) => Promise<Session>;
    messages: (sessionId: string) => Promise<SessionMessage[]>;
    timeline: (sessionId: string) => Promise<SessionTimeline>;
    delete: (sessionId: string) => Promise<DeleteResult>;
  };
  public readonly skills: {
    list: () => Promise<Skill[]>;
    get: (skillId: string) => Promise<SkillWithFiles>;
    create: (req: SkillCreateRequest) => Promise<Skill>;
    update: (skillId: string, req: SkillUpdateRequest) => Promise<Skill>;
    save: (req: SkillUpsertRequest) => Promise<Skill>;
    import: (req: SkillImportRequest) => Promise<Skill>;
    delete: (skillId: string) => Promise<DeleteResult>;
    files: {
      list: (skillId: string) => Promise<SkillFileSummary[]>;
      get: (skillId: string, path: string) => Promise<SkillFile>;
      set: (skillId: string, path: string, req: SetSkillFileRequest) => Promise<SetSkillFileResult>;
      delete: (skillId: string, path: string) => Promise<DeleteResult>;
    };
  };
  public readonly tools: {
    list: () => Promise<Tool[]>;
    get: (toolId: string) => Promise<Tool>;
    create: (req: ToolCreateRequest) => Promise<Tool>;
    delete: (toolId: string) => Promise<DeleteResult>;
    /**
     * Direct tool invocation (POST /api/v1/tools/invoke). API-key gated;
     * the key's tenant scope (if any) must match `tenantId`. The handler
     * resolves any per-tenant integration internally — callers never
     * touch decrypted credentials.
     */
    invoke: (req: ToolInvokeRequest) => Promise<ToolInvokeResponse>;
    skills: {
      list: (skillId: string) => Promise<Tool[]>;
      attach: (skillId: string, toolId: string) => Promise<AttachToolResult>;
      detach: (skillId: string, toolId: string) => Promise<DetachToolResult>;
    };
    secrets: {
      list: (skillId: string) => Promise<SkillSecretSummary[]>;
      set: (skillId: string, req: SetSkillSecretRequest) => Promise<SetSkillSecretResult>;
      delete: (skillId: string, key: string) => Promise<DeleteResult>;
    };
  };
  public readonly eval: {
    tests: {
      list: (skillId: string) => Promise<EvalCase[]>;
      create: (skillId: string, req: CreateEvalCaseRequest) => Promise<EvalCase>;
      delete: (skillId: string, testId: string) => Promise<DeleteResult>;
    };
    run: (req: RunEvalRequest) => Promise<EvalRunExecution>;
    runs: {
      get: (runId: string) => Promise<EvalRunWithResults>;
    };
    stats: (req?: EvalStatsRequest) => Promise<EvalStats>;
    failures: (req?: EvalFailuresRequest) => Promise<EvalFailureRow[]>;
    compare: (req: EvalCompareRequest) => Promise<EvalCompare>;
  };
  public readonly events: {
    list: (req: EventListRequest) => Promise<Event[]>;
  };
  public readonly runs: {
    /** Fetch the full event timeline for a single workflow run. */
    get: (runId: string) => Promise<WorkflowRunTimeline>;
    /** List recent workflow runs, optionally filtered by `clientId` and `since`. */
    list: (req?: WorkflowRunListRequest) => Promise<WorkflowRunSummary[]>;
    /**
     * Append a human-in-the-loop / external lifecycle event onto a run's
     * timeline so the trace shows the full story alongside the AI events.
     */
    appendEvent: (runId: string, req: AppendRunEventRequest) => Promise<AppendedRunEvent>;
  };
  /**
   * Builders for the `attachments[]` field on `chat()` / `workflow()`.
   * Pure helpers — they don't touch the network. Re-exported as standalone
   * `attachmentFromUrl` / `attachmentFromInline` / `attachmentFromRef`
   * functions for callers who only need the shape.
   */
  public readonly attachments: {
    fromUrl: (input: AttachmentFromUrlInput) => AttachmentInput;
    fromInline: (input: AttachmentFromInlineInput) => AttachmentInput;
    fromRef: (input: AttachmentFromRefInput) => AttachmentInput;
    /**
     * Returns a new `AttachmentInput` with `parseStrategy` set to
     * `strategy`. Pure — never mutates the input. See
     * `attachmentWithStrategy` for the standalone export.
     */
    withStrategy: (att: AttachmentInput, strategy: ParseStrategy) => AttachmentInput;
  };

  constructor(opts: BaoBoxClientOptions) {
    if (!opts.endpoint) throw new Error("BaoBoxClient: endpoint required");
    if (!opts.apiKey && !opts.adminSecret) {
      throw new Error("BaoBoxClient: apiKey or adminSecret required");
    }

    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.apiKey = opts.apiKey ?? null;
    this.adminSecret = opts.adminSecret ?? null;

    const rawFetch = opts.fetch ?? globalThis.fetch;
    this.fetch = rawFetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 30_000;

    this.health = {
      get: () => this.getHealth(),
    };

    this.admin = {
      keys: {
        list: () => this.listApiKeys(),
        create: (req) => this.createApiKey(req),
        delete: (id) => this.deleteApiKey(id),
      },
      stats: {
        get: (req) => this.getAdminStats(req),
      },
      logs: {
        list: (req) => this.listAdminLogs(req),
      },
      tasks: {
        list: () => this.listScheduledTasks(),
        create: (req) => this.createScheduledTask(req),
        update: (id, req) => this.updateScheduledTask(id, req),
        delete: (id) => this.deleteScheduledTask(id),
      },
      skills: {
        upsert: (req) => this.saveSkill(req),
      },
      tools: {
        upsert: (req) => this.createTool(req),
      },
    };

    this.sessions = {
      create: (req) => this.createSession(req),
      get: (id) => this.getSession(id),
      messages: (id) => this.listMessages(id),
      timeline: (id) => this.getSessionTimeline(id),
      delete: (id) => this.deleteSession(id),
    };

    this.skills = {
      list: () => this.listSkills(),
      get: (id) => this.getSkill(id),
      create: (req) => this.createSkill(req),
      update: (id, req) => this.updateSkill(id, req),
      save: (req) => this.saveSkill(req),
      import: (req) => this.importSkill(req),
      delete: (id) => this.deleteSkill(id),
      files: {
        list: (id) => this.listSkillFiles(id),
        get: (id, path) => this.getSkillFile(id, path),
        set: (id, path, req) => this.setSkillFile(id, path, req),
        delete: (id, path) => this.deleteSkillFile(id, path),
      },
    };

    this.tools = {
      list: () => this.listTools(),
      get: (id) => this.getTool(id),
      create: (req) => this.createTool(req),
      delete: (id) => this.deleteTool(id),
      invoke: (req) => this.invokeTool(req),
      skills: {
        list: (skillId) => this.listSkillTools(skillId),
        attach: (skillId, toolId) => this.attachToolToSkill(skillId, toolId),
        detach: (skillId, toolId) => this.detachToolFromSkill(skillId, toolId),
      },
      secrets: {
        list: (skillId) => this.listSkillSecrets(skillId),
        set: (skillId, req) => this.setSkillSecret(skillId, req),
        delete: (skillId, key) => this.deleteSkillSecret(skillId, key),
      },
    };

    this.eval = {
      tests: {
        list: (skillId) => this.listEvalTests(skillId),
        create: (skillId, req) => this.createEvalTest(skillId, req),
        delete: (skillId, testId) => this.deleteEvalTest(skillId, testId),
      },
      run: (req) => this.runEval(req),
      runs: {
        get: (runId) => this.getEvalRun(runId),
      },
      stats: (req) => this.getEvalStats(req),
      failures: (req) => this.listEvalFailures(req),
      compare: (req) => this.compareEvalVersions(req),
    };

    this.events = {
      list: (req) => this.listEvents(req),
    };

    this.runs = {
      get: (runId) => this.getRunTimeline(runId),
      list: (req) => this.listRuns(req),
      appendEvent: (runId, req) => this.appendRunEvent(runId, req),
    };

    this.attachments = {
      fromUrl: attachmentFromUrl,
      fromInline: attachmentFromInline,
      fromRef: attachmentFromRef,
      withStrategy: attachmentWithStrategy,
    };
  }

  chatStream(req: ChatStreamRequest): AsyncIterable<SseEvent> {
    return this.streamChat(req);
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    // 0.8.0: send camelCase on the wire (server prefers camel; snake
    // accepted during the Phase-1 deprecation window). Read camelCase
    // first, fall back to snake_case — so this SDK stays compatible with
    // a future Phase-3 server that emits camelCase only.
    const body = await this.requestApi<{
      response: string;
      usage: {
        inputTokens?: number;
        input_tokens?: number;
        outputTokens?: number;
        output_tokens?: number;
      };
      sessionId?: string;
      session_id?: string;
    }>(
      "POST",
      "/api/v1/chat",
      compactObject({
        skillId: req.skillId,
        message: req.message,
        sessionId: req.sessionId,
        metadata: req.metadata,
        attachments: attachmentsToWire(req.attachments),
      }),
    );

    const usage = body.data.usage;
    return {
      response: body.data.response,
      usage: {
        inputTokens: usage.inputTokens ?? usage.input_tokens ?? 0,
        outputTokens: usage.outputTokens ?? usage.output_tokens ?? 0,
      },
      sessionId: body.data.sessionId ?? body.data.session_id,
      meta: body.meta,
    };
  }

  // Single-turn, stateless skill execution. Caller passes the full
  // history every call; BaoBox writes events under the returned runId
  // and tags the call_logs row with run_type='workflow' + the tenant
  // correlators. See `WorkflowRequest`/`WorkflowResponse` for the shape.
  async workflow<TOutput = unknown>(req: WorkflowRequest): Promise<WorkflowResponse<TOutput>> {
    // 0.8.0: dual-shape wire (see chat() above for the rationale).
    const body = await this.requestApi<{
      response: string;
      output?: TOutput;
      runId?: string;
      run_id?: string;
      usage: {
        inputTokens?: number;
        input_tokens?: number;
        outputTokens?: number;
        output_tokens?: number;
      };
    }>(
      "POST",
      "/api/v1/workflow",
      compactObject({
        skill: req.skill,
        clientId: req.clientId,
        requestId: req.requestId,
        input: req.input,
        outputSchema: req.outputSchema,
        history: req.history,
        attachments: attachmentsToWire(req.attachments),
      }),
    );

    const usage = body.data.usage;
    return {
      response: body.data.response,
      output: body.data.output,
      runId: (body.data.runId ?? body.data.run_id) as string,
      usage: {
        inputTokens: usage.inputTokens ?? usage.input_tokens ?? 0,
        outputTokens: usage.outputTokens ?? usage.output_tokens ?? 0,
      },
      meta: body.meta,
    };
  }

  async workflowStructured<TOutput>(
    req: WorkflowRequest & { outputSchema: JsonObject },
  ): Promise<WorkflowResponse<TOutput> & { output: TOutput }> {
    const response = await this.workflow<TOutput>(req);
    if (response.output === undefined) {
      throw new BaoBoxError(
        0,
        "INVALID_RESPONSE",
        "BaoBox workflow response omitted structured output",
        response.meta.requestId,
        null,
      );
    }
    return response as WorkflowResponse<TOutput> & { output: TOutput };
  }

  private async *streamChat(req: ChatStreamRequest): AsyncGenerator<SseEvent> {
    if (!this.apiKey) {
      throw new Error("BaoBoxClient: apiKey required for chatStream");
    }

    const url = `${this.endpoint}/api/v1/chat/stream`;
    const body = compactObject({
      skillId: req.skillId,
      message: req.message,
      sessionId: req.sessionId,
      metadata: req.metadata,
      attachments: attachmentsToWire(req.attachments),
    });

    const controller = new AbortController();
    const timer =
      this.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : null;

    let res: Response;
    try {
      res = await this.fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      throw new BaoBoxError(
        0,
        isAbort ? "TIMEOUT" : "NETWORK",
        isAbort
          ? `chatStream to /api/v1/chat/stream timed out after ${this.timeoutMs}ms`
          : `Network error calling /api/v1/chat/stream: ${String(err)}`,
        null,
        null,
      );
    } finally {
      // Cancel the headers-received deadline — stream may now live forever.
      if (timer) clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const parsed = text.length ? safeParseJson(text) : {};
      const errObj = (
        parsed as { error?: { code?: string; message?: string; requestId?: string } }
      ).error;
      throw new BaoBoxError(
        res.status,
        errObj?.code ?? "HTTP_ERROR",
        errObj?.message ?? res.statusText,
        errObj?.requestId ?? null,
        parsed,
      );
    }

    if (!res.body) {
      throw new BaoBoxError(0, "NETWORK", "chatStream: response has no body", null, null);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split on double-newline (SSE frame separator).
        const frames = buffer.split("\n\n");
        // Last segment may be incomplete — keep it in the buffer.
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          if (!frame.trim()) continue;
          let eventName = "";
          let dataStr = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event: ")) {
              eventName = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataStr = line.slice(6);
            }
          }
          if (!eventName || !dataStr) continue;
          const data = safeParseJson(dataStr);
          // Normalize `done.data.session_id`: backend omits it on
          // refusal/error paths; SDK consumers see `string | null`.
          if (eventName === "done" && isJsonObject(data) && !("session_id" in data)) {
            (data as Record<string, unknown>).session_id = null;
          }
          yield { event: eventName, data } as SseEvent;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async getHealth(): Promise<HealthResponse> {
    const body = await this.requestNoAuth<{ status: "ok"; version: string }>("GET", "/api/v1/health");
    return {
      status: body.data.status,
      version: body.data.version,
      meta: body.meta,
    };
  }

  private async createSession(req: SessionCreateRequest = {}): Promise<Session> {
    const body = await this.requestAdmin<RawSession>(
      "POST",
      "/api/v1/sessions",
      compactObject({ skillId: req.skillId }),
    );
    return mapSession(body.data);
  }

  private async getSession(sessionId: string): Promise<Session> {
    const body = await this.requestAdmin<RawSession>(
      "GET",
      `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
    );
    return mapSession(body.data);
  }

  private async listMessages(sessionId: string): Promise<SessionMessage[]> {
    const body = await this.requestAdmin<RawSessionMessage[]>(
      "GET",
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
    return body.data.map(mapSessionMessage);
  }

  private async getSessionTimeline(sessionId: string): Promise<SessionTimeline> {
    const body = await this.requestAdmin<{ sessionId: string; events: RawEvent[] }>(
      "GET",
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/timeline`,
    );
    return {
      sessionId: body.data.sessionId,
      events: body.data.events.map(mapEvent),
    };
  }

  private async deleteSession(sessionId: string): Promise<DeleteResult> {
    const body = await this.requestAdmin<DeleteResult>(
      "DELETE",
      `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
    );
    return body.data;
  }

  private async listSkills(): Promise<Skill[]> {
    const body = await this.requestAdmin<RawSkill[]>("GET", "/api/v1/skills");
    return body.data.map(mapSkill);
  }

  private async getSkill(skillId: string): Promise<SkillWithFiles> {
    const body = await this.requestAdmin<RawSkillWithFiles>(
      "GET",
      `/api/v1/skills/${encodeURIComponent(skillId)}`,
    );
    return mapSkillWithFiles(body.data);
  }

  private async createSkill(req: SkillCreateRequest): Promise<Skill> {
    const body = await this.requestAdmin<RawSkill>(
      "POST",
      "/api/v1/skills",
      buildSkillWriteBody(req),
    );
    const skill = mapSkill(body.data);
    if (req.tools) await this.syncSkillTools(skill.id, req.tools);
    return skill;
  }

  private async updateSkill(skillId: string, req: SkillUpdateRequest): Promise<Skill> {
    const writeBody = buildSkillWriteBody(req);
    const hasFieldUpdates = Object.keys(writeBody).length > 0;

    const skill = hasFieldUpdates
      ? mapSkill(
          (
            await this.requestAdmin<RawSkill>(
              "PUT",
              `/api/v1/skills/${encodeURIComponent(skillId)}`,
              writeBody,
            )
          ).data,
        )
      : skillWithoutFiles(await this.getSkill(skillId));

    if (req.tools) await this.syncSkillTools(skillId, req.tools);
    return skill;
  }

  private async saveSkill(req: SkillUpsertRequest): Promise<Skill> {
    return req.id ? this.updateSkill(req.id, req) : this.createSkill(req);
  }

  private async importSkill(req: SkillImportRequest): Promise<Skill> {
    const body = await this.requestAdmin<RawSkill>("POST", "/api/v1/skills/import", {
      url: req.url,
      name: req.name,
    });
    return mapSkill(body.data);
  }

  private async deleteSkill(skillId: string): Promise<DeleteResult> {
    const body = await this.requestAdmin<DeleteResult>(
      "DELETE",
      `/api/v1/skills/${encodeURIComponent(skillId)}`,
    );
    return body.data;
  }

  private async listSkillFiles(skillId: string): Promise<SkillFileSummary[]> {
    const body = await this.requestAdmin<RawSkillFileSummary[]>(
      "GET",
      `/api/v1/skills/${encodeURIComponent(skillId)}/files`,
    );
    return body.data.map(mapSkillFileSummary);
  }

  private async getSkillFile(skillId: string, path: string): Promise<SkillFile> {
    const body = await this.requestAdmin<RawSkillFile>(
      "GET",
      `/api/v1/skills/${encodeURIComponent(skillId)}/files/${encodePath(path)}`,
    );
    return mapSkillFile(body.data);
  }

  private async setSkillFile(
    skillId: string,
    path: string,
    req: SetSkillFileRequest,
  ): Promise<SetSkillFileResult> {
    const body = await this.requestAdmin<SetSkillFileResult>(
      "PUT",
      `/api/v1/skills/${encodeURIComponent(skillId)}/files/${encodePath(path)}`,
      { content: req.content },
    );
    return body.data;
  }

  private async deleteSkillFile(skillId: string, path: string): Promise<DeleteResult> {
    const body = await this.requestAdmin<DeleteResult>(
      "DELETE",
      `/api/v1/skills/${encodeURIComponent(skillId)}/files/${encodePath(path)}`,
    );
    return body.data;
  }

  private async listTools(): Promise<Tool[]> {
    const body = await this.requestAdmin<RawTool[]>("GET", "/api/v1/tools");
    return body.data.map(mapTool);
  }

  private async getTool(toolId: string): Promise<Tool> {
    const body = await this.requestAdmin<RawTool>(
      "GET",
      `/api/v1/tools/${encodeURIComponent(toolId)}`,
    );
    return mapTool(body.data);
  }

  private async createTool(req: ToolCreateRequest): Promise<Tool> {
    const body = await this.requestAdmin<RawTool>("POST", "/api/v1/tools", {
      name: req.name,
      description: req.description,
      inputSchema: req.inputSchema,
      handlerType: req.handlerType,
      handlerConfig: req.handlerConfig,
      // Forwarded only for emit_block tools; harmless (ignored server-side) for
      // builtin/http. Undefined is dropped by JSON.stringify, so non-emit
      // callers send nothing extra.
      emitSchemaRef: req.emitSchemaRef,
    });
    return mapTool(body.data);
  }

  private async deleteTool(toolId: string): Promise<DeleteResult> {
    const body = await this.requestAdmin<DeleteResult>(
      "DELETE",
      `/api/v1/tools/${encodeURIComponent(toolId)}`,
    );
    return body.data;
  }

  private async invokeTool(req: ToolInvokeRequest): Promise<ToolInvokeResponse> {
    // 0.8.1 regression fix: /api/v1/tools/invoke is an API-key-gated public
    // SDK endpoint, NOT part of the ι epic admin/operator camelCase flip.
    // The server schema still uses snake_case `tenant_id` and `tool_call_id`
    // for this route. SDK 0.8.0 incorrectly bundled it into the admin hard
    // cutover; this reverts to the byte-identical 0.7.x wire shape. When
    // the BaoBox team flips this endpoint to camelCase (which would need a
    // #142-style dual-emit window for the public boundary), this mapping
    // moves with it.
    const body = await this.requestApi<{
      tool_call_id: string;
      status: "SUCCESS";
      result: unknown;
    }>("POST", "/api/v1/tools/invoke", {
      tool: req.tool,
      tenant_id: req.tenantId,
      inputs: req.inputs,
    });
    return {
      toolCallId: body.data.tool_call_id,
      status: body.data.status,
      result: body.data.result,
      meta: body.meta,
    };
  }

  private async listSkillTools(skillId: string): Promise<Tool[]> {
    const body = await this.requestAdmin<RawTool[]>(
      "GET",
      `/api/v1/tools/skills/${encodeURIComponent(skillId)}/tools`,
    );
    return body.data.map(mapTool);
  }

  private async attachToolToSkill(skillId: string, toolId: string): Promise<AttachToolResult> {
    const body = await this.requestAdmin<AttachToolResult>(
      "POST",
      `/api/v1/tools/skills/${encodeURIComponent(skillId)}/tools/${encodeURIComponent(toolId)}`,
    );
    return body.data;
  }

  private async detachToolFromSkill(skillId: string, toolId: string): Promise<DetachToolResult> {
    const body = await this.requestAdmin<DetachToolResult>(
      "DELETE",
      `/api/v1/tools/skills/${encodeURIComponent(skillId)}/tools/${encodeURIComponent(toolId)}`,
    );
    return body.data;
  }

  private async listSkillSecrets(skillId: string): Promise<SkillSecretSummary[]> {
    const body = await this.requestAdmin<RawSkillSecretSummary[]>(
      "GET",
      `/api/v1/tools/skills/${encodeURIComponent(skillId)}/secrets`,
    );
    return body.data.map(mapSkillSecretSummary);
  }

  private async setSkillSecret(
    skillId: string,
    req: SetSkillSecretRequest,
  ): Promise<SetSkillSecretResult> {
    const body = await this.requestAdmin<SetSkillSecretResult>(
      "PUT",
      `/api/v1/tools/skills/${encodeURIComponent(skillId)}/secrets`,
      { key: req.key, value: req.value },
    );
    return body.data;
  }

  private async deleteSkillSecret(skillId: string, key: string): Promise<DeleteResult> {
    const body = await this.requestAdmin<DeleteResult>(
      "DELETE",
      `/api/v1/tools/skills/${encodeURIComponent(skillId)}/secrets/${encodeURIComponent(key)}`,
    );
    return body.data;
  }

  private async listApiKeys(): Promise<ApiKey[]> {
    const body = await this.requestAdmin<RawApiKey[]>("GET", "/api/v1/admin/keys");
    return body.data.map(mapApiKey);
  }

  private async createApiKey(req: CreateApiKeyRequest): Promise<CreatedApiKey> {
    const body = await this.requestAdmin<RawCreatedApiKey>("POST", "/api/v1/admin/keys", compactObject({
      name: req.name,
      permissions: req.permissions,
      rateLimit: req.rateLimit,
      expiresAt: req.expiresAt,
      tenantId: req.tenantId,
    }));
    return {
      id: body.data.apiKeyId,
      key: body.data.key,
      name: body.data.name,
      tenantId: body.data.tenantId,
    };
  }

  private async deleteApiKey(id: string): Promise<DeleteResult> {
    const body = await this.requestAdmin<DeleteResult>(
      "DELETE",
      `/api/v1/admin/keys/${encodeURIComponent(id)}`,
    );
    return body.data;
  }

  private async getAdminStats(req?: { since?: string }): Promise<AdminStats> {
    const body = await this.requestAdmin<AdminStats>(
      "GET",
      appendQuery("/api/v1/admin/stats", { since: req?.since }),
    );
    return body.data;
  }

  private async listAdminLogs(req?: { limit?: number }): Promise<CallLogRow[]> {
    const body = await this.requestAdmin<CallLogRow[]>(
      "GET",
      appendQuery("/api/v1/admin/logs", {
        limit: req?.limit !== undefined ? String(req.limit) : undefined,
      }),
    );
    return body.data;
  }

  private async listScheduledTasks(): Promise<ScheduledTask[]> {
    const body = await this.requestAdmin<RawScheduledTask[]>("GET", "/api/v1/admin/tasks");
    return body.data.map(mapScheduledTask);
  }

  private async createScheduledTask(
    req: CreateScheduledTaskRequest,
  ): Promise<ScheduledTask | null> {
    const body = await this.requestAdmin<RawScheduledTask | null>("POST", "/api/v1/admin/tasks", compactObject({
      name: req.name,
      skillId: req.skillId,
      prompt: req.prompt,
      telegramChatId: req.telegramChatId,
      schedule: req.schedule,
    }));
    return body.data ? mapScheduledTask(body.data) : null;
  }

  private async updateScheduledTask(
    id: string,
    req: UpdateScheduledTaskRequest,
  ): Promise<ScheduledTask | null> {
    const body = await this.requestAdmin<RawScheduledTask | null>(
      "PATCH",
      `/api/v1/admin/tasks/${encodeURIComponent(id)}`,
      compactObject({
        enabled: req.enabled,
        schedule: req.schedule,
        prompt: req.prompt,
      }),
    );
    return body.data ? mapScheduledTask(body.data) : null;
  }

  private async deleteScheduledTask(id: string): Promise<DeleteResult> {
    const body = await this.requestAdmin<DeleteResult>(
      "DELETE",
      `/api/v1/admin/tasks/${encodeURIComponent(id)}`,
    );
    return body.data;
  }

  private async listEvalTests(skillId: string): Promise<EvalCase[]> {
    const body = await this.requestAdmin<RawEvalCase[]>(
      "GET",
      `/api/v1/eval/skills/${encodeURIComponent(skillId)}/tests`,
    );
    return body.data.map(mapEvalCase);
  }

  private async createEvalTest(skillId: string, req: CreateEvalCaseRequest): Promise<EvalCase> {
    const body = await this.requestAdmin<RawEvalCase>(
      "POST",
      `/api/v1/eval/skills/${encodeURIComponent(skillId)}/tests`,
      compactObject({
        name: req.name,
        input: req.input,
        expectedBehavior: req.expectedBehavior,
        dimensions: req.dimensions,
        passingThreshold: req.passingThreshold,
      }),
    );
    return mapEvalCase(body.data);
  }

  private async deleteEvalTest(skillId: string, testId: string): Promise<DeleteResult> {
    const body = await this.requestAdmin<DeleteResult>(
      "DELETE",
      `/api/v1/eval/skills/${encodeURIComponent(skillId)}/tests/${encodeURIComponent(testId)}`,
    );
    return body.data;
  }

  private async runEval(req: RunEvalRequest): Promise<EvalRunExecution> {
    const body = await this.requestAdmin<RawEvalRunExecution>("POST", "/api/v1/eval/run", compactObject({
      skillId: req.skillId,
      testCaseIds: req.testCaseIds,
      promptVersion: req.promptVersion,
    }));
    return mapEvalRunExecution(body.data);
  }

  private async getEvalRun(runId: string): Promise<EvalRunWithResults> {
    const body = await this.requestAdmin<RawEvalRun & { results: RawEvalRunResult[] }>(
      "GET",
      `/api/v1/eval/runs/${encodeURIComponent(runId)}`,
    );
    return {
      ...mapEvalRun(body.data),
      results: body.data.results.map(mapEvalRunResult),
    };
  }

  private async getEvalStats(req?: EvalStatsRequest): Promise<EvalStats> {
    const body = await this.requestAdmin<RawEvalStats>(
      "GET",
      appendQuery("/api/v1/eval/stats", {
        skillId: req?.skillId,
        since: req?.since,
      }),
    );
    return {
      skillId: body.data.skillId,
      period: body.data.period,
      summary: body.data.summary
        ? {
            total: body.data.summary.total,
            avgScore: body.data.summary.avgScore,
            distribution: body.data.summary.distribution,
          }
        : null,
      trend: body.data.trend,
    };
  }

  private async listEvalFailures(req?: EvalFailuresRequest): Promise<EvalFailureRow[]> {
    const body = await this.requestAdmin<EvalFailureRow[]>(
      "GET",
      appendQuery("/api/v1/eval/failures", {
        skillId: req?.skillId,
        threshold: req?.threshold !== undefined ? String(req.threshold) : undefined,
        limit: req?.limit !== undefined ? String(req.limit) : undefined,
      }),
    );
    return body.data;
  }

  private async compareEvalVersions(req: EvalCompareRequest): Promise<EvalCompare> {
    const body = await this.requestAdmin<RawEvalCompare>(
      "GET",
      appendQuery("/api/v1/eval/compare", {
        skillId: req.skillId,
        a: req.a,
        b: req.b,
      }),
    );
    return {
      skillId: body.data.skillId,
      versionA: body.data.versionA,
      versionB: body.data.versionB,
    };
  }

  private async listEvents(req: EventListRequest): Promise<Event[]> {
    const timeline = await this.getSessionTimeline(req.sessionId);
    return timeline.events;
  }

  private async getRunTimeline(runId: string): Promise<WorkflowRunTimeline> {
    const body = await this.requestAdmin<RawWorkflowRunTimeline>(
      "GET",
      `/api/v1/admin/runs/${encodeURIComponent(runId)}/timeline`,
    );
    return {
      runId: body.data.runId,
      events: body.data.events.map(mapEvent),
    };
  }

  private async listRuns(req?: WorkflowRunListRequest): Promise<WorkflowRunSummary[]> {
    const body = await this.requestAdmin<RawWorkflowRunSummary[]>(
      "GET",
      appendQuery("/api/v1/admin/runs", {
        clientId: req?.clientId,
        since: req?.since,
        limit: req?.limit !== undefined ? String(req.limit) : undefined,
      }),
    );
    return body.data.map(mapWorkflowRunSummary);
  }

  private async appendRunEvent(
    runId: string,
    req: AppendRunEventRequest,
  ): Promise<AppendedRunEvent> {
    const body = await this.requestAdmin<RawAppendedRunEvent>(
      "POST",
      `/api/v1/admin/runs/${encodeURIComponent(runId)}/events`,
      compactObject({
        eventType: req.eventType,
        content: req.content,
        metadata: req.metadata,
        parentEventId: req.parentEventId,
      }),
    );
    return {
      id: body.data.eventId,
      runId: body.data.runId,
      eventType: body.data.eventType,
    };
  }

  private async syncSkillTools(skillId: string, desiredToolIds: string[]): Promise<void> {
    const desired = new Set(desiredToolIds);
    const current = await this.listSkillTools(skillId);
    const currentIds = new Set(current.map((tool) => tool.id));

    for (const toolId of currentIds) {
      if (!desired.has(toolId)) {
        await this.detachToolFromSkill(skillId, toolId);
      }
    }

    for (const toolId of desired) {
      if (!currentIds.has(toolId)) {
        await this.attachToolToSkill(skillId, toolId);
      }
    }
  }

  private async requestNoAuth<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<ApiEnvelope<T>> {
    return this.request<T>(method, path, "none", body);
  }

  private async requestApi<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<ApiEnvelope<T>> {
    return this.request<T>(method, path, "apiKey", body);
  }

  private async requestAdmin<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<ApiEnvelope<T>> {
    return this.request<T>(method, path, "adminSecret", body);
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    authMode: AuthMode,
    body?: unknown,
  ): Promise<ApiEnvelope<T>> {
    const url = `${this.endpoint}${path}`;
    const controller = new AbortController();
    const headers = {
      ...this.getAuthHeaders(authMode),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    };
    const timer =
      this.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : null;

    let res: Response;
    try {
      res = await this.fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
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
      // 0.8.0: error envelope dual-shape (`requestId` Phase 3+, `request_id`
      // Phase 1 / legacy). Read camel first; fall back to snake.
      const errObj = (
        parsed as {
          error?: {
            code?: string;
            message?: string;
            requestId?: string;
            request_id?: string;
          };
        }
      ).error;
      throw new BaoBoxError(
        res.status,
        errObj?.code ?? "HTTP_ERROR",
        errObj?.message ?? res.statusText,
        errObj?.requestId ?? errObj?.request_id ?? null,
        parsed,
      );
    }

    const envelope = parsed as {
      data: T;
      metadata?: RawMetadata;
    };

    return {
      data: envelope.data,
      meta: mapResponseMeta(envelope.metadata),
    };
  }

  private getAuthHeaders(authMode: AuthMode): Record<string, string> {
    if (authMode === "none") return {};

    if (authMode === "apiKey") {
      if (!this.apiKey) {
        throw new Error("BaoBoxClient: apiKey required for chat methods");
      }
      return { authorization: `Bearer ${this.apiKey}` };
    }

    if (!this.adminSecret) {
      throw new Error("BaoBoxClient: adminSecret required for admin methods");
    }
    return { authorization: `Bearer ${this.adminSecret}` };
  }
}

function mapResponseMeta(metadata?: RawMetadata): ResponseMeta {
  if (!metadata) return { requestId: "", latencyMs: 0 };

  // 0.8.0: dual-shape envelope — prefer camelCase, fall back to snake_case
  // so this SDK keeps parsing both Phase-1 (dual-emit) and Phase-3
  // (camel-only) server responses.
  return {
    requestId: metadata.requestId ?? metadata.request_id ?? "",
    latencyMs: metadata.latencyMs ?? metadata.latency_ms ?? 0,
    model: metadata.model,
    trace: metadata.trace?.map((trace) => ({
      toolName: trace.toolName ?? trace.tool_name ?? "",
      input: trace.input,
      output: trace.output,
      latencyMs: trace.latencyMs ?? trace.latency_ms ?? 0,
    })),
  };
}

function mapSession(raw: RawSession): Session {
  return {
    id: raw.sessionId,
    skillId: raw.skillId,
    tenantId: raw.tenantId,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function mapSessionMessage(raw: RawSessionMessage): SessionMessage {
  return {
    id: raw.messageId,
    sessionId: raw.sessionId,
    role: raw.role,
    content: raw.content,
    tokenCount: raw.tokenCount,
    createdAt: raw.createdAt,
  };
}

function mapEvent(raw: RawEvent): Event {
  return {
    id: raw.eventId,
    sessionId: raw.sessionId,
    requestId: raw.requestId,
    runId: raw.runId ?? null,
    eventType: raw.eventType,
    content: raw.content,
    metadata: toJsonObject(raw.metadata),
    tokenCount: raw.tokenCount,
    latencyMs: raw.latencyMs,
    parentEventId: raw.parentEventId,
    createdAt: raw.createdAt,
  };
}

function mapSkill(raw: RawSkill): Skill {
  return {
    id: raw.skillId,
    name: raw.name,
    description: raw.description,
    systemPrompt: raw.systemPrompt,
    model: raw.model,
    temperature: raw.temperature,
    maxTokens: raw.maxTokens,
    sourceUrl: raw.sourceUrl,
    tenantId: raw.tenantId,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function mapSkillWithFiles(raw: RawSkillWithFiles): SkillWithFiles {
  return {
    ...mapSkill(raw),
    files: raw.files.map((file): SkillFileReference => ({
      path: file.path,
      size: file.size,
    })),
  };
}

function skillWithoutFiles(skill: SkillWithFiles): Skill {
  const { files: _files, ...rest } = skill;
  return rest;
}

function mapSkillFileSummary(raw: RawSkillFileSummary): SkillFileSummary {
  return {
    path: raw.path,
    size: raw.size,
    updatedAt: raw.updatedAt,
  };
}

function mapSkillFile(raw: RawSkillFile): SkillFile {
  return {
    id: raw.skillFileId,
    skillId: raw.skillId,
    path: raw.path,
    content: raw.content,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function mapTool(raw: RawTool): Tool {
  return {
    id: raw.toolId,
    name: raw.name,
    description: raw.description,
    inputSchema: raw.inputSchema,
    handlerType: raw.handlerType,
    handlerConfig: raw.handlerConfig,
    emitSchemaRef: raw.emitSchemaRef ?? null,
    createdAt: raw.createdAt,
  };
}

function mapSkillSecretSummary(raw: RawSkillSecretSummary): SkillSecretSummary {
  return {
    id: raw.skillSecretId,
    key: raw.key,
    createdAt: raw.createdAt,
  };
}

function mapApiKey(raw: RawApiKey): ApiKey {
  return {
    apiKeyId: raw.apiKeyId,
    name: raw.name,
    permissions: raw.permissions,
    rateLimit: raw.rateLimit,
    tenantId: raw.tenantId,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
  };
}

function mapScheduledTask(raw: RawScheduledTask): ScheduledTask {
  return {
    id: raw.taskId,
    name: raw.name,
    skillId: raw.skillId,
    prompt: raw.prompt,
    telegramChatId: raw.telegramChatId,
    schedule: raw.schedule,
    enabled: raw.enabled,
    createdAt: raw.createdAt,
    lastRunAt: raw.lastRunAt,
  };
}

function mapEvalCase(raw: RawEvalCase): EvalCase {
  return {
    id: raw.evalCaseId,
    skillId: raw.skillId,
    name: raw.name,
    input: raw.input,
    expectedBehavior: raw.expectedBehavior,
    dimensions: raw.dimensions,
    passingThreshold: raw.passingThreshold,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function mapEvalRunExecution(raw: RawEvalRunExecution): EvalRunExecution {
  return {
    runId: raw.evalRunId,
    status: raw.status,
    totalCases: raw.totalCases,
    passed: raw.passed,
    failed: raw.failed,
    avgScore: raw.avgScore,
    results: raw.results.map(mapEvalRunResultSummary),
    durationMs: raw.durationMs,
  };
}

function mapEvalRunResultSummary(raw: RawEvalRunExecution["results"][number]): EvalRunResultSummary {
  return {
    testCaseId: raw.evalCaseId,
    status: raw.status,
    score: raw.score,
    scores: raw.scores,
    response: raw.response,
    reasoning: raw.reasoning,
  };
}

function mapEvalRun(raw: RawEvalRun): Omit<EvalRunWithResults, "results"> {
  return {
    id: raw.evalRunId,
    skillId: raw.skillId,
    promptVersion: raw.promptVersion,
    status: raw.status,
    totalCases: raw.totalCases,
    passed: raw.passed,
    failed: raw.failed,
    avgScore: raw.avgScore,
    metadata: raw.metadata,
    createdAt: raw.createdAt,
    completedAt: raw.completedAt,
  };
}

function mapWorkflowRunSummary(raw: RawWorkflowRunSummary): WorkflowRunSummary {
  return {
    callLogId: raw.callLogId,
    requestId: raw.requestId,
    runId: raw.runId,
    skillId: raw.skillId,
    clientId: raw.clientId,
    externalRequestId: raw.externalRequestId,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    totalTokens: raw.totalTokens,
    latencyMs: raw.latencyMs,
    toolCallsCount: raw.toolCallsCount,
    status: raw.status,
    errorCode: raw.errorCode,
    createdAt: raw.createdAt,
  };
}

function mapEvalRunResult(raw: RawEvalRunResult): EvalRunResult {
  return {
    id: raw.evalRunResultId,
    runId: raw.evalRunId,
    testCaseId: raw.evalCaseId,
    sessionId: raw.sessionId,
    status: raw.status,
    score: raw.score,
    scoresJson: raw.scoresJson,
    response: raw.response,
    reasoning: raw.reasoning,
    latencyMs: raw.latencyMs,
    llmInputJson: raw.llmInputJson ?? null,
    createdAt: raw.createdAt,
  };
}

function buildSkillWriteBody(req: SkillCreateRequest | SkillUpdateRequest): Record<string, unknown> {
  // 0.8.0: BaoBox admin surface accepts camelCase request bodies after the
  // ι epic. The previous snake_case keys are no longer recognized.
  return compactObject({
    name: req.name,
    description: req.description,
    systemPrompt: req.systemPrompt,
    model: req.model,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
    sourceUrl: req.sourceUrl,
    files: req.files,
  });
}

function appendQuery(path: string, query: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) qs.set(key, value);
  }
  const suffix = qs.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function compactObject<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

function toJsonObject(input: unknown): JsonObject {
  if (typeof input === "string") {
    const parsed = safeParseJson(input);
    return isJsonObject(parsed) ? parsed : {};
  }
  return isJsonObject(input) ? input : {};
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// --- Attachments (0.6.0) ---
//
// Pure helpers — no client state needed. Exposed both as standalone exports
// and as `client.attachments.*` (see constructor) for fluent use.

export type AttachmentFromUrlInput = {
  /** Signed HTTPS URL. The BaoBox worker fetches lazily — bytes never sit on the SDK side. */
  url: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Optional 64-char lowercase hex sha256 — enables BaoBox's parse cache. */
  checksumSha256?: string;
  /** Optional request headers BaoBox should attach when fetching the URL. */
  auth?: Record<string, string>;
  /** Defaults to `"auto"` server-side when omitted. */
  parseStrategy?: AttachmentInput["parseStrategy"];
};

export type AttachmentFromInlineInput = {
  /** Raw bytes — encoded to base64 inside the helper. */
  bytes: Uint8Array | ArrayBuffer;
  filename?: string;
  mimeType?: string;
  /** Defaults to `"auto"` server-side when omitted. */
  parseStrategy?: AttachmentInput["parseStrategy"];
};

export type AttachmentFromRefInput = {
  /** Existing BaoBox attachment id (`att_…`). */
  attId: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Defaults to `"auto"` server-side when omitted. */
  parseStrategy?: AttachmentInput["parseStrategy"];
};

export function attachmentFromUrl(input: AttachmentFromUrlInput): AttachmentInput {
  if (!input.url.startsWith("https://")) {
    throw new Error("attachmentFromUrl: url must be https://");
  }
  const source: AttachmentInputUrl = {
    kind: "url",
    url: input.url,
    ...(input.checksumSha256 !== undefined ? { checksumSha256: input.checksumSha256 } : {}),
    ...(input.auth !== undefined ? { auth: input.auth } : {}),
  };
  return buildAttachment(source, input);
}

export function attachmentFromInline(input: AttachmentFromInlineInput): AttachmentInput {
  const byteLength =
    input.bytes instanceof Uint8Array ? input.bytes.byteLength : input.bytes.byteLength;
  // Mirrors the server's 413 ATTACHMENT_TOO_LARGE so callers fail fast.
  if (byteLength > MAX_INLINE_BYTES) {
    throw new Error(
      `attachmentFromInline: inline payload exceeds ${MAX_INLINE_BYTES} bytes (got ${byteLength})`,
    );
  }
  const source: AttachmentInputInline = {
    kind: "inline",
    bytesBase64: encodeBase64(input.bytes),
  };
  return buildAttachment(source, { ...input, sizeBytes: byteLength });
}

export function attachmentFromRef(input: AttachmentFromRefInput): AttachmentInput {
  const source: AttachmentInputBaoboxRef = { kind: "baobox_ref", attId: input.attId };
  return buildAttachment(source, { ...input, attId: input.attId });
}

function buildAttachment(
  source: AttachmentInput["source"],
  meta: {
    attId?: string;
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
    parseStrategy?: AttachmentInput["parseStrategy"];
  },
): AttachmentInput {
  return {
    ...(meta.attId !== undefined ? { attId: meta.attId } : {}),
    ...(meta.filename !== undefined ? { filename: meta.filename } : {}),
    ...(meta.mimeType !== undefined ? { mimeType: meta.mimeType } : {}),
    ...(meta.sizeBytes !== undefined ? { sizeBytes: meta.sizeBytes } : {}),
    source,
    ...(meta.parseStrategy !== undefined ? { parseStrategy: meta.parseStrategy } : {}),
  };
}

// 0.7.0 — fluent override for `parseStrategy`. Returns a NEW attachment;
// never mutates the input. See README "Choosing a parse strategy" for
// the four tiers and when to pin each one.
export function attachmentWithStrategy(
  att: AttachmentInput,
  strategy: ParseStrategy,
): AttachmentInput {
  return { ...att, parseStrategy: strategy };
}

// Wire conversion — camelCase domain → snake_case JSON. Centralized so
// the chat()/workflow() bodies stay terse and so the snake_case keys
// match `baobox/src/routes/_attachment.schemas.ts` exactly.
function attachmentsToWire(attachments?: AttachmentInput[]): unknown[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return attachments.map(attachmentToWire);
}

function attachmentToWire(att: AttachmentInput): Record<string, unknown> {
  return compactObject({
    att_id: att.attId,
    filename: att.filename,
    mime_type: att.mimeType,
    size_bytes: att.sizeBytes,
    source: sourceToWire(att.source),
    parse_strategy: att.parseStrategy,
  });
}

function sourceToWire(source: AttachmentInput["source"]): Record<string, unknown> {
  if (source.kind === "url") {
    return compactObject({
      kind: "url",
      url: source.url,
      checksum_sha256: source.checksumSha256,
      auth: source.auth,
    });
  }
  if (source.kind === "inline") {
    return { kind: "inline", bytes_base64: source.bytesBase64 };
  }
  return { kind: "baobox_ref", att_id: source.attId };
}

// Encode bytes to base64 without pulling in a runtime dep. Node 18+ has
// `Buffer`; browsers / Workers have `btoa` over a binary string.
function encodeBase64(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(view).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < view.length; i++) {
    const byte = view[i] ?? 0;
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
