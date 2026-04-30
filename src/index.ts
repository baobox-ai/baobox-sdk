import { BaoBoxError } from "./errors.js";
import type {
  AdminStats,
  ApiKey,
  AppendedRunEvent,
  AppendRunEventRequest,
  AttachToolResult,
  BaoBoxClientOptions,
  CallerPushedEventType,
  CallLogRow,
  ChatRequest,
  ChatResponse,
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
export type * from "./types.js";

type FetchFn = typeof globalThis.fetch;
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type AuthMode = "none" | "apiKey" | "adminSecret";

type ApiEnvelope<T> = {
  data: T;
  meta: ResponseMeta;
};

type RawMetadata = {
  request_id: string;
  latency_ms: number;
  model?: string;
  trace?: Array<{
    tool_name: string;
    input: JsonObject;
    output: unknown;
    latency_ms: number;
  }>;
};

type RawSession = {
  id: string;
  skill_id: string;
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
};

type RawSessionMessage = {
  id: number;
  session_id: string;
  role: SessionMessage["role"];
  content: string;
  token_count: number;
  created_at: string;
};

type RawEvent = {
  id: string;
  session_id: string | null;
  request_id: string | null;
  run_id?: string | null;
  event_type: Event["eventType"];
  content: string | null;
  metadata: unknown;
  token_count: number;
  latency_ms: number;
  parent_event_id: string | null;
  created_at: string;
};

type RawSkill = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  temperature: number;
  max_tokens: number;
  source_url: string | null;
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
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
  updated_at: string;
};

type RawSkillFile = {
  id: string;
  skill_id: string;
  path: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type RawTool = {
  id: string;
  name: string;
  description: string;
  input_schema: string;
  handler_type: Tool["handlerType"];
  handler_config: string;
  created_at: string;
};

type RawSkillSecretSummary = {
  id: string;
  key: string;
  created_at: string;
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
  id: string;
  key: string;
  name: string;
  tenant_id: string;
};

type RawScheduledTask = {
  id: string;
  name: string;
  skill_id: string;
  prompt: string;
  telegram_chat_id: number | null;
  schedule: string;
  enabled: number;
  created_at: string;
  last_run_at: string | null;
};

type RawEvalCase = {
  id: string;
  skill_id: string;
  name: string;
  input: string;
  expected_behavior: string;
  dimensions: string;
  passing_threshold: number;
  created_at: string;
  updated_at: string;
};

type RawEvalRunExecution = {
  run_id: string;
  status: string;
  total_cases: number;
  passed: number;
  failed: number;
  avg_score: number | null;
  results: Array<{
    test_case_id: string;
    status: string;
    score: number | null;
    scores: unknown;
    response: string | null;
    reasoning: string | null;
  }>;
  duration_ms: number;
};

type RawEvalRun = {
  id: string;
  skill_id: string;
  prompt_version: string | null;
  status: string;
  total_cases: number;
  passed: number;
  failed: number;
  avg_score: number | null;
  metadata: string;
  created_at: string;
  completed_at: string | null;
};

type RawEvalRunResult = {
  id: string;
  run_id: string;
  test_case_id: string;
  session_id: string | null;
  status: string;
  score: number | null;
  scores_json: string | null;
  response: string | null;
  reasoning: string | null;
  latency_ms: number;
  /** Added in BaoBox migration 0018; older backends omit it. */
  llm_input_json?: string | null;
  created_at: string;
};

type RawEvalStats = {
  skill_id: string;
  period: { since: string };
  summary:
    | {
        total: number;
        avg_score: number;
        distribution: Record<string, number>;
      }
    | null;
  trend: Record<string, unknown>[];
};

type RawWorkflowRunSummary = {
  call_log_id: string;
  request_id: string;
  run_id: string | null;
  skill_id: string | null;
  client_id: string | null;
  external_request_id: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  latency_ms: number;
  tool_calls_count: number;
  status: string;
  error_code: string | null;
  created_at: string;
};

type RawWorkflowRunTimeline = {
  run_id: string;
  events: RawEvent[];
};

type RawAppendedRunEvent = {
  id: string;
  run_id: string;
  event_type: CallerPushedEventType;
};

type RawEvalCompare = {
  skill_id: string;
  version_a: {
    label: string;
    dimensions: Record<string, unknown>[];
  };
  version_b: {
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
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = await this.requestApi<{
      response: string;
      usage: { input_tokens: number; output_tokens: number };
      session_id?: string;
    }>("POST", "/api/v1/chat", compactObject({
      skill_id: req.skillId,
      message: req.message,
      session_id: req.sessionId,
      metadata: req.metadata,
    }));

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

  // Single-turn, stateless skill execution. Caller passes the full
  // history every call; BaoBox writes events under the returned runId
  // and tags the call_logs row with run_type='workflow' + the tenant
  // correlators. See `WorkflowRequest`/`WorkflowResponse` for the shape.
  async workflow<TOutput = unknown>(req: WorkflowRequest): Promise<WorkflowResponse<TOutput>> {
    const body = await this.requestApi<{
      response: string;
      output?: TOutput;
      run_id: string;
      usage: { input_tokens: number; output_tokens: number };
    }>("POST", "/api/v1/workflow", compactObject({
      skill: req.skill,
      client_id: req.clientId,
      request_id: req.requestId,
      input: req.input,
      output_schema: req.outputSchema,
      history: req.history,
    }));

    return {
      response: body.data.response,
      output: body.data.output,
      runId: body.data.run_id,
      usage: {
        inputTokens: body.data.usage.input_tokens,
        outputTokens: body.data.usage.output_tokens,
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
      compactObject({ skill_id: req.skillId }),
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
    const body = await this.requestAdmin<{ session_id: string; events: RawEvent[] }>(
      "GET",
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/timeline`,
    );
    return {
      sessionId: body.data.session_id,
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
      input_schema: req.inputSchema,
      handler_type: req.handlerType,
      handler_config: req.handlerConfig,
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
      rate_limit: req.rateLimit,
      expires_at: req.expiresAt,
    }));
    return {
      id: body.data.id,
      key: body.data.key,
      name: body.data.name,
      tenantId: body.data.tenant_id,
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
      skill_id: req.skillId,
      prompt: req.prompt,
      telegram_chat_id: req.telegramChatId,
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
        expected_behavior: req.expectedBehavior,
        dimensions: req.dimensions,
        passing_threshold: req.passingThreshold,
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
      skill_id: req.skillId,
      test_case_ids: req.testCaseIds,
      prompt_version: req.promptVersion,
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
        skill_id: req?.skillId,
        since: req?.since,
      }),
    );
    return {
      skillId: body.data.skill_id,
      period: body.data.period,
      summary: body.data.summary
        ? {
            total: body.data.summary.total,
            avgScore: body.data.summary.avg_score,
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
        skill_id: req?.skillId,
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
        skill_id: req.skillId,
        a: req.a,
        b: req.b,
      }),
    );
    return {
      skillId: body.data.skill_id,
      versionA: body.data.version_a,
      versionB: body.data.version_b,
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
      runId: body.data.run_id,
      events: body.data.events.map(mapEvent),
    };
  }

  private async listRuns(req?: WorkflowRunListRequest): Promise<WorkflowRunSummary[]> {
    const body = await this.requestAdmin<RawWorkflowRunSummary[]>(
      "GET",
      appendQuery("/api/v1/admin/runs", {
        client_id: req?.clientId,
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
        event_type: req.eventType,
        content: req.content,
        metadata: req.metadata,
        parent_event_id: req.parentEventId,
      }),
    );
    return {
      id: body.data.id,
      runId: body.data.run_id,
      eventType: body.data.event_type,
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
      const errObj = (parsed as { error?: { code?: string; message?: string; request_id?: string } })
        .error;
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

  return {
    requestId: metadata.request_id,
    latencyMs: metadata.latency_ms,
    model: metadata.model,
    trace: metadata.trace?.map((trace) => ({
      toolName: trace.tool_name,
      input: trace.input,
      output: trace.output,
      latencyMs: trace.latency_ms,
    })),
  };
}

function mapSession(raw: RawSession): Session {
  return {
    id: raw.id,
    skillId: raw.skill_id,
    tenantId: raw.tenant_id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapSessionMessage(raw: RawSessionMessage): SessionMessage {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    role: raw.role,
    content: raw.content,
    tokenCount: raw.token_count,
    createdAt: raw.created_at,
  };
}

function mapEvent(raw: RawEvent): Event {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    requestId: raw.request_id,
    runId: raw.run_id ?? null,
    eventType: raw.event_type,
    content: raw.content,
    metadata: toJsonObject(raw.metadata),
    tokenCount: raw.token_count,
    latencyMs: raw.latency_ms,
    parentEventId: raw.parent_event_id,
    createdAt: raw.created_at,
  };
}

function mapSkill(raw: RawSkill): Skill {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    systemPrompt: raw.system_prompt,
    model: raw.model,
    temperature: raw.temperature,
    maxTokens: raw.max_tokens,
    sourceUrl: raw.source_url,
    tenantId: raw.tenant_id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
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
    updatedAt: raw.updated_at,
  };
}

function mapSkillFile(raw: RawSkillFile): SkillFile {
  return {
    id: raw.id,
    skillId: raw.skill_id,
    path: raw.path,
    content: raw.content,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapTool(raw: RawTool): Tool {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    inputSchema: raw.input_schema,
    handlerType: raw.handler_type,
    handlerConfig: raw.handler_config,
    createdAt: raw.created_at,
  };
}

function mapSkillSecretSummary(raw: RawSkillSecretSummary): SkillSecretSummary {
  return {
    id: raw.id,
    key: raw.key,
    createdAt: raw.created_at,
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
    id: raw.id,
    name: raw.name,
    skillId: raw.skill_id,
    prompt: raw.prompt,
    telegramChatId: raw.telegram_chat_id,
    schedule: raw.schedule,
    enabled: raw.enabled,
    createdAt: raw.created_at,
    lastRunAt: raw.last_run_at,
  };
}

function mapEvalCase(raw: RawEvalCase): EvalCase {
  return {
    id: raw.id,
    skillId: raw.skill_id,
    name: raw.name,
    input: raw.input,
    expectedBehavior: raw.expected_behavior,
    dimensions: raw.dimensions,
    passingThreshold: raw.passing_threshold,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapEvalRunExecution(raw: RawEvalRunExecution): EvalRunExecution {
  return {
    runId: raw.run_id,
    status: raw.status,
    totalCases: raw.total_cases,
    passed: raw.passed,
    failed: raw.failed,
    avgScore: raw.avg_score,
    results: raw.results.map(mapEvalRunResultSummary),
    durationMs: raw.duration_ms,
  };
}

function mapEvalRunResultSummary(raw: RawEvalRunExecution["results"][number]): EvalRunResultSummary {
  return {
    testCaseId: raw.test_case_id,
    status: raw.status,
    score: raw.score,
    scores: raw.scores,
    response: raw.response,
    reasoning: raw.reasoning,
  };
}

function mapEvalRun(raw: RawEvalRun): Omit<EvalRunWithResults, "results"> {
  return {
    id: raw.id,
    skillId: raw.skill_id,
    promptVersion: raw.prompt_version,
    status: raw.status,
    totalCases: raw.total_cases,
    passed: raw.passed,
    failed: raw.failed,
    avgScore: raw.avg_score,
    metadata: raw.metadata,
    createdAt: raw.created_at,
    completedAt: raw.completed_at,
  };
}

function mapWorkflowRunSummary(raw: RawWorkflowRunSummary): WorkflowRunSummary {
  return {
    callLogId: raw.call_log_id,
    requestId: raw.request_id,
    runId: raw.run_id,
    skillId: raw.skill_id,
    clientId: raw.client_id,
    externalRequestId: raw.external_request_id,
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    totalTokens: raw.total_tokens,
    latencyMs: raw.latency_ms,
    toolCallsCount: raw.tool_calls_count,
    status: raw.status,
    errorCode: raw.error_code,
    createdAt: raw.created_at,
  };
}

function mapEvalRunResult(raw: RawEvalRunResult): EvalRunResult {
  return {
    id: raw.id,
    runId: raw.run_id,
    testCaseId: raw.test_case_id,
    sessionId: raw.session_id,
    status: raw.status,
    score: raw.score,
    scoresJson: raw.scores_json,
    response: raw.response,
    reasoning: raw.reasoning,
    latencyMs: raw.latency_ms,
    llmInputJson: raw.llm_input_json ?? null,
    createdAt: raw.created_at,
  };
}

function buildSkillWriteBody(req: SkillCreateRequest | SkillUpdateRequest): Record<string, unknown> {
  return compactObject({
    name: req.name,
    description: req.description,
    system_prompt: req.systemPrompt,
    model: req.model,
    temperature: req.temperature,
    max_tokens: req.maxTokens,
    source_url: req.sourceUrl,
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
