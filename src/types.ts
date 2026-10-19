export type JsonObject = Record<string, unknown>;

export type BaoBoxClientOptions = {
  /** Full URL to the BaoBox worker, e.g. "https://baobox-acme.example.workers.dev" */
  endpoint: string;
  /** API key issued by BaoBox admin. Required for `/api/v1/chat`. */
  apiKey?: string;
  /** ADMIN_SECRET bearer token. Required for admin, skills, tools, sessions, and eval APIs. */
  adminSecret?: string;
  /** Optional tag for observability — not sent over the wire yet. */
  orgId?: string;
  /**
   * Optional `fetch` override. Use this in tests to inject a mock, or in
   * edge runtimes that ship a non-global fetch.
   */
  fetch?: typeof globalThis.fetch;
  /** Request timeout in ms. Default 30 000. Set to 0 to disable. */
  timeoutMs?: number;
};

export type ResponseMeta = {
  requestId: string;
  latencyMs: number;
  model?: string;
  /**
   * Which provider transport the server actually used for the call
   * (`/workflow` and `/chat`). Absent on servers that predate it.
   */
  transport?: "stream" | "non_stream";
  trace?: ToolTrace[];
};

export type ToolTrace = {
  toolName: string;
  input: JsonObject;
  output: unknown;
  latencyMs: number;
};

export type DeleteResult = {
  deleted: boolean;
};

// --- Health ---

export type HealthResponse = {
  status: "ok";
  version: string;
  meta: ResponseMeta;
};

// --- Attachments (added 0.6.0) ---
//
// Mirrors BaoBox's per-request `attachments[]` contract — the wire-level
// schema lives in `baobox/src/routes/_attachment.schemas.ts` and the
// domain shape in `baobox/src/shared/types/attachment.ts`. The SDK
// surface is camelCase; the client converts to snake_case on the wire so
// callers never see `bytes_base64` / `att_id` / `parse_strategy`.
//
// Three source modes:
//   - `url`        : signed URL pointing at the caller's R2 (BaoBox
//                    fetches lazily). Optional `checksumSha256` for
//                    cache key + integrity verification.
//   - `inline`     : raw bytes (≤ 5 MB after base64 decode). The
//                    `fromInline()` helper handles base64 + size guard.
//   - `baobox_ref` : re-use a previously-uploaded BaoBox R2 object by
//                    `attId`. No bytes on the wire.
//
// `parseStrategy` requests a parsing tier; `"auto"` lets BaoBox choose.

export type ParseStrategy = "auto" | "filename" | "extract_text" | "llamaparse";

export type AttachmentInputUrl = {
  kind: "url";
  url: string;
  checksumSha256?: string;
  auth?: Record<string, string>;
};

export type AttachmentInputInline = {
  kind: "inline";
  bytesBase64: string;
};

export type AttachmentInputBaoboxRef = {
  kind: "baobox_ref";
  attId: string;
};

export type AttachmentSource =
  | AttachmentInputUrl
  | AttachmentInputInline
  | AttachmentInputBaoboxRef;

export type AttachmentInput = {
  /** Optional pre-assigned id (`att_…`). The server generates one if omitted. */
  attId?: string;
  filename?: string;
  mimeType?: string;
  /** Declared byte count — informational only. Bytes are sized server-side. */
  sizeBytes?: number;
  source: AttachmentSource;
  /** Defaults to `"auto"` server-side when omitted. */
  parseStrategy?: ParseStrategy;
};

/** Server-imposed 5 MB cap on the decoded inline payload. */
export const MAX_INLINE_BYTES = 5 * 1024 * 1024;

// --- Chat ---

/**
 * S1-1 (#368) — optional memory scope. Narrows per-user long-term memory to a
 * client / matter / task so concurrent contexts don't contaminate each other.
 */
export type ChatScope = {
  clientId?: string;
  matterId?: string;
  taskId?: string;
};

export type ChatRequest = {
  skillId?: string;
  message: string;
  sessionId?: string;
  metadata?: JsonObject;
  /**
   * S1-1 (#368) — the tenant's OWN stable end-user id (BaoBox never mints it).
   * Buckets per-user long-term memory. Optional + additive: omit for the
   * pre-#368 anonymous/session scope.
   */
  externalUserId?: string;
  /** S1-1 (#368) — optional memory scope (client / matter / task). */
  scope?: ChatScope;
  /** Optional inbound attachments. See `client.attachments.*` for builders. */
  attachments?: AttachmentInput[];
};

export type ChatResponse = {
  response: string;
  usage: { inputTokens: number; outputTokens: number };
  sessionId?: string;
  /**
   * B1 (epic #170 §3.7): a guardrail block is not an error — the server
   * answers 200 with a single refusal frame instead of throwing. Present
   * only on a refused turn; check this (or `blocks`) rather than
   * string-sniffing `response` to detect a refusal. See `RefusalBlock`.
   */
  refusalSurface?: RefusalSurface;
  /** Refusal blocks: set only on a refused turn, to a single `RefusalBlock`
   * (alongside `refusalSurface`). Never set on a normal turn — the turn's
   * own blocks are in `content`. */
  blocks?: ContentBlock[];
  /**
   * 0.32.0 — the turn's content blocks as the server sent them in
   * `data.content` (text, tool calls / results, `structured` blocks — including
   * a decision skill's `baobox.decision.v1` answer; see `decisionOutputOf`).
   * Absent when the server sent none, and on a refused turn.
   */
  content?: ContentBlock[];
  meta: ResponseMeta;
};

// --- Workflow ---
//
// Single-turn, stateless skill execution. The caller passes the full
// conversation history every call — BaoBox doesn't persist any session
// state for workflow runs. `clientId` and `requestId` are tenant
// correlators that land on `call_logs` so the caller can join workflow
// runs back to their own request log. `runId` is BaoBox-generated and
// is the only handle for retrieving the trace timeline afterwards.

export type WorkflowHistoryRole = "user" | "assistant" | "system";

export type WorkflowHistoryEntry = {
  role: WorkflowHistoryRole;
  content: string;
};

export type WorkflowRequest = {
  /** ID of the skill to invoke (e.g. "sk_email_chase_xxx"). */
  skill: string;
  /** Tenant-side client identifier; persisted on the call_logs row. */
  clientId: string;
  /** Tenant-side request identifier; persisted on call_logs.external_request_id. */
  requestId: string;
  /** The new user input for this turn. */
  input: string;
  /** Optional schema that BaoBox should use to parse / validate structured output. */
  outputSchema?: JsonObject;
  /** Optional prior conversation history. Caller is responsible for state. */
  history?: WorkflowHistoryEntry[];
  /** Optional inbound attachments. See `client.attachments.*` for builders. */
  attachments?: AttachmentInput[];
};

export type WorkflowResponse<TOutput = unknown> = {
  response: string;
  /**
   * Present when `outputSchema` was supplied and BaoBox validated structured
   * output, or — with no `outputSchema` — when the skill is a decision skill
   * (the `DecisionSkillOutput` object; a decision skill refuses `outputSchema`
   * with 422 `decision_skill_output_schema_unsupported`). Absent on a refusal.
   */
  output?: TOutput;
  /** BaoBox-generated run id (`wflow_…`). Use this to fetch the trace. Absent
   * on a refusal frame — see `refusalSurface`. */
  runId: string;
  usage: { inputTokens: number; outputTokens: number };
  /**
   * B1 (epic #170 §3.7): a guardrail block is not an error — the server
   * answers 200 with a single refusal frame instead of throwing. Present
   * only on a refused turn; check this (or `blocks`) rather than
   * string-sniffing `response` to detect a refusal. See `RefusalBlock`.
   */
  refusalSurface?: RefusalSurface;
  /** Content blocks for the turn. Today only populated with a single
   * `RefusalBlock` when `refusalSurface` is set. */
  blocks?: ContentBlock[];
  meta: ResponseMeta;
};

// --- Runs (workflow-run admin views + caller-pushed events) ---
//
// Added in SDK 0.4.0 against BaoBox's `/api/v1/admin/runs/*` surface.
// Use these to:
//  - render a per-run trace in your front-end (`get`)
//  - list a tenant's recent workflow runs (`list`)
//  - inject human/external lifecycle events into a run's timeline
//    (`appendEvent`) so the trace tells the full story.

export type WorkflowRunSummary = {
  /** call_logs.id — the row that recorded this run. */
  callLogId: string;
  /** Internal request id (BaoBox-generated for observability correlation). */
  requestId: string;
  /** BaoBox-generated run id. Use this with `runs.get` and `runs.appendEvent`. */
  runId: string | null;
  skillId: string | null;
  clientId: string | null;
  /** The caller-supplied request id passed in the original `workflow()` call. */
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

export type WorkflowRunTimeline = {
  runId: string;
  events: Event[];
};

export type WorkflowRunListRequest = {
  /** Tenant-side identifier originally passed in the workflow() call. */
  clientId?: string;
  /** ISO timestamp lower bound (e.g. "2026-04-01T00:00:00Z"). */
  since?: string;
  /** Defaults to 50 server-side. Capped at 200. */
  limit?: number;
};

export type AppendRunEventRequest = {
  eventType: CallerPushedEventType;
  /** Optional human-readable description (e.g. the email subject sent). */
  content?: string;
  /** Free-form structured data (staff_user, message_id, attachment_count, …). */
  metadata?: JsonObject;
  /** Chain this event under another event in the same run, if relevant. */
  parentEventId?: string;
};

export type AppendedRunEvent = {
  /** New event id (`evt_…`). */
  id: string;
  runId: string;
  eventType: CallerPushedEventType;
};

// --- Sessions ---

export type Session = {
  id: string;
  skillId: string;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
  /** D1 — arbitrary JSON metadata blob. Null until the first `sessions.updateMetadata()` call. */
  metadata?: JsonObject | null;
};

export type SessionCreateRequest = {
  skillId?: string;
  /**
   * Bind the new session to a tenant (multi-tenant consumers, #239). The
   * session's `tenantId` is set server-side and scopes the session so it
   * cannot read another tenant's data. Sent on the wire as the `tenantId`
   * body field; the BaoBox server also accepts an `X-BaoBox-Tenant-Id`
   * header for raw-fetch callers, but the SDK uses the body field. Omit for
   * an unscoped (single-tenant / admin) session.
   */
  tenantId?: string;
};

export type SessionRole = "user" | "assistant" | "system" | "tool";

export type SessionMessage = {
  id: number;
  sessionId: string;
  role: SessionRole;
  content: string;
  tokenCount: number;
  createdAt: string;
};

// AI events emitted by the BaoBox runtime + caller-pushed events for
// human-in-the-loop or external steps. The five `human_*` / `external_*`
// types are appended via `client.runs.appendEvent` so a workflow run's
// timeline can interleave AI activity with surrounding human/external
// state transitions.
//
// B1 (0.11.0): sandwich guardrail event types added — preflight/postflight
// verdict events, retry/exhausted events, guardrail_disabled, refusal_emitted,
// and injection_detected.
export type EventType =
  | "user_message"
  | "assistant_message"
  | "system_message"
  | "llm_call_start"
  | "llm_call_end"
  | "tool_call"
  | "tool_result"
  | "error"
  | "human_review_started"
  | "human_approved"
  | "human_rejected"
  | "external_send"
  | "external_reply_received"
  // B1 — sandwich guardrail events
  | "preflight_pass"
  | "preflight_block"
  | "postflight_pass"
  | "postflight_redact"
  | "postflight_block"
  | "postflight_retry_triggered"
  | "postflight_retry_exhausted"
  | "postflight_retry_skipped_side_effects"
  | "guardrail_disabled"
  | "refusal_emitted"
  | "injection_detected";

/**
 * Event types a caller is allowed to push onto a run's timeline via
 * `client.runs.appendEvent`. The runtime-only types (`llm_call_*`,
 * `tool_*`, `*_message`, `error`) are emitted by BaoBox itself and are
 * never accepted from external callers.
 */
export type CallerPushedEventType =
  | "human_review_started"
  | "human_approved"
  | "human_rejected"
  | "external_send"
  | "external_reply_received";

// session_id is nullable since BaoBox migration 0017 — workflow events
// only have run_id, not a session. run_id is the workflow correlator.
//
// D1 (0.11.0): `actorUserId` added — email of the tenant user who triggered
// the turn. Null on admin/sandbox paths. Optional so older server responses
// (which omit the field) remain compatible.
export type Event = {
  id: string;
  sessionId: string | null;
  requestId: string | null;
  runId: string | null;
  eventType: EventType;
  content: string | null;
  metadata: JsonObject;
  tokenCount: number;
  latencyMs: number;
  parentEventId: string | null;
  createdAt: string;
  /** D1 — email of the tenant user who triggered the turn. Null on admin/sandbox paths. */
  actorUserId?: string | null;
};

export type SessionTimeline = {
  sessionId: string;
  events: Event[];
};

export type EventListRequest = {
  sessionId: string;
};

// --- Session metadata (D1, 0.11.0) ---

/**
 * Request body for `client.sessions.updateMetadata()`. Must be a plain
 * JSON object (not an array or primitive). Serialized length is capped
 * at 65 536 bytes server-side.
 */
export type SessionMetadataUpdateRequest = JsonObject;

export type SessionMetadataUpdateResult = {
  sessionId: string;
  metadata: JsonObject;
};

// --- Guardrail config (B1, 0.11.0) ---

/**
 * Request body for `client.skills.updateGuardrails()` (tenant-scoped path).
 * Only addenda can be set via this surface — disabled flags are admin-only.
 */
export type SkillGuardrailUpdateRequest = {
  /** Addendum injected into the pre-flight guard's `{customization}` placeholder. Null to clear. */
  preflightAddendum?: string | null;
  /** Addendum injected into the post-flight guard's `{customization}` placeholder. Null to clear. */
  postflightAddendum?: string | null;
};

export type SkillGuardrailUpdateResult = {
  skillId: string;
  preflightAddendum: string | null;
  postflightAddendum: string | null;
};

/**
 * Request body for `client.admin.skills.setGuardrailDisabled()` (admin-only path).
 * Can set disabled flags AND addenda on any skill, including system skills.
 */
export type AdminSkillGuardrailUpdateRequest = {
  /** Kill-switch: bypass the pre-flight guard entirely when true. Admin-only. */
  preflightDisabled?: boolean;
  /** Kill-switch: bypass the post-flight guard entirely when true. Admin-only. */
  postflightDisabled?: boolean;
  /** Addendum injected into the pre-flight guard's `{customization}` placeholder. Null to clear. */
  preflightAddendum?: string | null;
  /** Addendum injected into the post-flight guard's `{customization}` placeholder. Null to clear. */
  postflightAddendum?: string | null;
};

export type AdminSkillGuardrailUpdateResult = {
  skillId: string;
  /** 1 = disabled, 0 = enabled. */
  preflightDisabled: number;
  /** 1 = disabled, 0 = enabled. */
  postflightDisabled: number;
  preflightAddendum: string | null;
  postflightAddendum: string | null;
  /** 1 = system skill, 0 = user skill. */
  isSystem: number;
};

/**
 * Request body for `client.admin.skills.setGuardSelection()` (admin-only
 * path, #306). Selects WHICH guard skill runs the pre-/post-flight check on
 * the target skill — distinct from `updateGuardrails`/`setGuardrailDisabled`,
 * which configure the addenda and kill-switches on whichever guard is
 * currently selected. `null` reverts the slot to the platform-default system
 * guard.
 */
export type SkillGuardSelectionUpdateRequest = {
  /** Guard skill id to run pre-flight. `null` reverts to the platform default. */
  guardrailPreflightSkillId?: string | null;
  /** Guard skill id to run post-flight. `null` reverts to the platform default. */
  guardrailPostflightSkillId?: string | null;
};

export type SkillGuardSelectionUpdateResult = {
  skillId: string;
  guardrailPreflightSkillId: string | null;
  guardrailPostflightSkillId: string | null;
};

// --- Skills ---

export type SkillFileInput = {
  path: string;
  content: string;
};

/**
 * Controls how much reasoning compute the model applies before generating a
 * response. Mirrors the OpenAI-API reasoning-effort tier set (excluding
 * `null`). **Which values a given model accepts is model-dependent** —
 * `"minimal"` is accepted by some models (e.g. gpt-5/mini/nano variants)
 * while `"none"` and `"xhigh"` are accepted by others (e.g. newer gpt-5.x
 * variants that drop `"minimal"`). The SDK exposes the full set; per-model
 * validity is enforced server-side. Omit to use the server-side default.
 *
 * Note: per-role model config and fallback model chains are server/portal-
 * side concerns and are not authored through the SDK in this release. That
 * surface is tracked as a follow-on (#301).
 */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** Per-model params stored on a skill (server `llmParams`). */
export type SkillLlmParams = {
  reasoningEffort?: ReasoningEffort;
};

/**
 * How the server talks to the model provider for a skill's calls.
 *
 * - `auto` (default): streams from the provider internally when the call's
 *   effective max tokens is >= 15 000, otherwise does not.
 * - `stream`: requests streaming from the provider for every call. It is a
 *   request, not a guarantee — a provider that cannot stream (or refuses a
 *   stream and is retried) runs `non_stream`; `meta.transport` on the
 *   `/workflow` / `/chat` response reports what actually happened.
 * - `non_stream`: never streams. Very long generations (several minutes) may
 *   then be cut before the provider responds.
 *
 * This is internal to the server; the SDK response shape is the same either way.
 * The server stores `auto` as `null`, so a skill read back carries
 * `null | "stream" | "non_stream"` — never `"auto"`.
 */
export type SkillLlmTransport = "auto" | "stream" | "non_stream";

/** Where a skill's LLM credentials resolve from. */
export type SkillLlmSource = "tenant_default" | "platform" | "pinned";

// ─── Decision skills (0.32.0) ────────────────────────────────────────────────
//
// A decision skill answers a fixed list of typed questions (yes/no, pick-one,
// score) about the message it is given, on a DECISION model (TypeSafe Jev or
// OpenAI Decisions), and returns one JSON object (`DecisionSkillOutput`)
// instead of free text.

/**
 * What a skill is. `"chat"` (the default; every skill created before decision
 * skills existed) writes text on a chat model. `"decision"` answers the typed
 * questions in `decisionSpec` on a decision model. Immutable after create.
 */
export type SkillKind = "chat" | "decision";

/**
 * One question of a decision skill. The list is ORDERED: the canonical output's
 * `answers` follow the same order.
 *
 * Common fields: `id` matches `^[a-z][a-z0-9_]{0,31}$` and is unique within the
 * spec; `prompt` is 1–2000 characters; `label` (optional) is at most 80.
 * Unknown keys are refused by the server.
 *
 * - `boolean` — `labels` are the display words for yes / no (≤ 40 chars each,
 *   default "yes" / "no"); `criteria` say what a yes / a no MEANS (≤ 500
 *   chars each); `threshold` is strictly between 0 and 1 (default 0.5) and
 *   `answer.value = probability >= threshold`.
 * - `choice` — 2–255 `options`; each `value` matches `^[A-Za-z0-9_.-]{1,64}$`
 *   and is unique, `description` ≤ 500 chars, `label` ≤ 80.
 * - `score` — 2–10 `levels`, ordered low → high; unique `label` (≤ 80 chars),
 *   `description` ≤ 500 chars.
 */
export type DecisionSkillQuestion =
  | {
      id: string;
      type: "boolean";
      prompt: string;
      label?: string;
      labels?: { true: string; false: string };
      criteria?: { true: string; false: string };
      threshold?: number;
    }
  | {
      id: string;
      type: "choice";
      prompt: string;
      label?: string;
      options: { value: string; description: string; label?: string }[];
    }
  | {
      id: string;
      type: "score";
      prompt: string;
      label?: string;
      levels: { label: string; description: string }[];
    };

/**
 * The questions a decision skill answers (`Skill.decisionSpec`).
 *
 * - `version` — always `1`.
 * - `questions` — 1–20 questions (see `DecisionSkillQuestion`).
 * - `state` — what rides in the decision state besides the user message:
 *   `history` = the last N session turns (integer 0–10, default 0);
 *   `attachments` = the turn's parsed attachment text (default `true`).
 */
export type DecisionSkillSpec = {
  version: 1;
  questions: DecisionSkillQuestion[];
  state?: { history?: number; attachments?: boolean };
};

/**
 * The `schema_ref` of the `structured` content block that carries a decision
 * skill's answer on `/chat` and `/chat/stream`.
 */
export const DECISION_SKILL_SCHEMA_REF = "baobox.decision.v1";

/** A `boolean` question's answer. */
export type DecisionSkillBooleanAnswer = {
  type: "boolean";
  /** `probability >= threshold`. */
  value: boolean;
  /** p(true), 3 decimal places. */
  probability: number;
  threshold: number;
};

/** A `choice` question's answer. */
export type DecisionSkillChoiceAnswer = {
  type: "choice";
  /** The chosen option's `value`. */
  value: string;
  label: string;
  /** option value → probability, in spec order, 3 decimal places. */
  probabilities: Record<string, number>;
  confidence: number;
};

/** A `score` question's answer. */
export type DecisionSkillScoreAnswer = {
  type: "score";
  /** Level index (0 = lowest): argmax of `probabilities`, ties → lower index. */
  value: number;
  label: string;
  /** The probability-weighted level (fractional), 3 decimal places. */
  expected: number;
  /** p(level i), index-aligned with the spec's `levels`, 3 decimal places. */
  probabilities: number[];
  confidence: number;
};

export type DecisionSkillAnswer =
  | DecisionSkillBooleanAnswer
  | DecisionSkillChoiceAnswer
  | DecisionSkillScoreAnswer;

/**
 * A decision skill's answer (`baobox.decision.v1`) — one shape on every
 * channel:
 * - `POST /workflow` → `WorkflowResponse.output` is this object and `response`
 *   is its JSON text (use `bb.workflow<DecisionSkillOutput>(…)`). A decision
 *   skill refuses `outputSchema` (422 `decision_skill_output_schema_unsupported`).
 * - `POST /chat` → `response` is the JSON text and `blocks` holds one
 *   `structured` block whose `schema_ref` is `DECISION_SKILL_SCHEMA_REF` and
 *   whose `data` is this object.
 * - `/chat/stream` → the `assistant_message` frame's `blocks` carry the same
 *   block.
 *
 * `decisionOutputOf(response)` extracts it from either response type.
 *
 * `usage` and `latency_ms` are snake_case ON PURPOSE: this is the payload
 * contract (the same JSON the server stores and returns as text), not the
 * camelCase response envelope. Do not camelCase it.
 */
export type DecisionSkillOutput = {
  kind: "decision";
  version: 1;
  skillId: string;
  provider: string;
  /** The model id the vendor echoed. */
  model: string;
  /** question id → answer, in spec order. */
  answers: Record<string, DecisionSkillAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
};

export type SkillCreateRequest = {
  name: string;
  description?: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * How much reasoning compute to apply. Optional — omit to use the
   * server-side default. See `ReasoningEffort` for the tiers. On update, `null`
   * clears a previously set value (on create it is the same as omitting it). `none` disables thinking on models that support a
   * toggle; a tier the model does not accept is reported by the server as an
   * ignored parameter. Sent on the wire as `llmParams.reasoningEffort`.
   */
  reasoningEffort?: ReasoningEffort | null;
  /**
   * Pin a specific tenant LLM integration (the model runs on that
   * integration's provider/key). `null` clears the pin → tenant default.
   * Tenant-scoped; the key's tenant must own the integration (server 4xx
   * otherwise). A chat skill cannot pin a decision-only integration (422
   * `integration_not_chat_capable`); a decision skill must pin a
   * decision-capable one (see `skillKind`).
   */
  llmIntegrationId?: string | null;
  /**
   * Provider transport for this skill's calls. See `SkillLlmTransport`. On
   * update, `null` clears a previously set value back to `auto` (on create it
   * is the same as omitting it).
   */
  llmTransport?: SkillLlmTransport | null;
  /**
   * 0.32.0 — what the skill is. Omit for `"chat"` on create; on update, omit
   * to keep the stored kind. The kind cannot change after create (422
   * `decision_skill_kind_immutable`); any value other than `chat` / `decision`
   * is rejected (400 at the API-key / admin edge, 422 `invalid_skill_kind`
   * elsewhere).
   *
   * A `"decision"` skill (see `DecisionSkillSpec`):
   * - must pin a decision-capable integration via `llmIntegrationId` (a
   *   TypeSafe Jev or OpenAI row; list them with
   *   `llmIntegrations.list({ use: "decision" })`) — 422
   *   `decision_skill_requires_pin` / `integration_not_decision_capable`;
   * - `model` must be a versioned decision model id of that provider, or
   *   omitted for the provider's default (422 `invalid_decision_model`);
   * - `systemPrompt` is the preamble prepended to every question, at most
   *   4000 characters (413 `decision_preamble_too_large`);
   * - has no `files` / `fileLoadMode: "on_demand"` (422
   *   `decision_skill_no_files`), no tools (`decision_skill_no_tools`), no
   *   sub-skills (`decision_skill_no_sub_skills`) and no `main` role-model pin
   *   (`decision_skill_no_main_pin`);
   * - is tenant-owned only (422 `decision_skill_global_unsupported`);
   * - starts with the preflight guard off; the postflight guard never runs.
   */
  skillKind?: SkillKind;
  /**
   * 0.32.0 — the questions a decision skill answers. Required with
   * `skillKind: "decision"` (422 `decision_spec_required`), refused on a chat
   * skill (422 `decision_spec_not_allowed`). Omit on update to keep the stored
   * spec. An invalid spec is a 400 at the API-key / admin edge (one validation
   * issue per problem) and a 422 `decision_spec_invalid` with
   * `details.errors[]` on other surfaces. `null` is forwarded as-is: it is a
   * no-op on a chat skill and cannot clear a decision skill's spec.
   */
  decisionSpec?: DecisionSkillSpec | null;
  sourceUrl?: string;
  files?: SkillFileInput[];
  /**
   * SDK convenience field. The backend manages these via `/tools/skills/...`;
   * the client will reconcile attachments after create/update.
   */
  tools?: string[];
};

export type SkillUpdateRequest = Partial<SkillCreateRequest>;

/**
 * Optional tenant scope for admin skill reads/writes (#247). An admin-secret
 * client is cross-tenant by default; pass `tenantId` to act on behalf of a
 * single tenant — `skills.list` then returns that tenant's skills plus global
 * system skills, and `skills.get` / `skills.update` return 404 (not 403) for a
 * skill owned by another tenant. Mirrors `sessions.create({ tenantId })`.
 * Omitting it preserves the cross-tenant (global) behaviour.
 */
export type SkillScopeOptions = {
  tenantId?: string;
};

export type SkillUpsertRequest = SkillCreateRequest & {
  id?: string;
};

export type Skill = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /**
   * Reasoning effort configured on this skill. Optional — absent when the
   * server has no explicit value set (uses its built-in default).
   */
  reasoningEffort?: ReasoningEffort | null;
  /** Raw per-model params as stored by the server (`null` when unset). */
  llmParams?: SkillLlmParams | null;
  /** Pinned tenant LLM integration id, or `null` (tenant default / platform). */
  llmIntegrationId?: string | null;
  /** Credential source the server resolved for this skill. */
  llmSource?: SkillLlmSource;
  /**
   * Provider transport configured on this skill (`null` = `auto`). Reads are
   * `null | "stream" | "non_stream"`: an explicit `auto` is stored and returned
   * as `null`.
   */
  llmTransport?: SkillLlmTransport | null;
  /**
   * 0.32.0 — `"chat"` or `"decision"`. Absent on servers that predate decision
   * skills; treat absent as `"chat"`. See `SkillKind`.
   */
  skillKind?: SkillKind;
  /**
   * 0.32.0 — the questions a decision skill answers. `null` on every chat
   * skill; set on every decision skill. Absent on older servers.
   */
  decisionSpec?: DecisionSkillSpec | null;
  sourceUrl: string | null;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SkillFileSummary = {
  path: string;
  size: number;
  updatedAt: string;
};

export type SkillFileReference = {
  path: string;
  size: number;
};

export type SkillWithFiles = Skill & {
  files: SkillFileReference[];
};

export type SkillImportRequest = {
  url: string;
  name?: string;
};

export type SkillFile = {
  id: string;
  skillId: string;
  path: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type SetSkillFileRequest = {
  content: string;
};

export type SetSkillFileResult = {
  path: string;
  updated: boolean;
};

// --- Tools ---

// "emit_block" (0.10.0): a server-side no-op handler. When the model calls an
// emit_block tool, BaoBox validates the call args against the tool's
// `inputSchema` and packages them into a `structured` ContentBlock
// (`{ type:"structured", emit_id, schema_ref, data }`) instead of running an
// external handler. Use it to make a skill produce structured payloads the
// consumer UI routes on by `schema_ref`. See `StructuredBlock` + `emitSchemaRef`.
export type ToolHandlerType = "builtin" | "http" | "emit_block";

export type ToolCreateRequest = {
  name: string;
  description: string;
  inputSchema: JsonObject;
  handlerType: ToolHandlerType;
  handlerConfig: JsonObject;
  /**
   * Routing key stamped onto the emitted `structured` block's `schema_ref`.
   * Required when `handlerType: "emit_block"`; ignored otherwise. Free-form —
   * there is no schema registry. The payload is validated against `inputSchema`
   * (which must be a root object with `additionalProperties:false` at every
   * level, every property listed in `required`, no `$ref`, no root `oneOf`).
   * Defaults to the tool `name` server-side when omitted.
   */
  emitSchemaRef?: string | null;
};

export type ToolUpsertRequest = ToolCreateRequest;

export type Tool = {
  id: string;
  name: string;
  description: string;
  inputSchema: string;
  handlerType: ToolHandlerType;
  handlerConfig: string;
  /** Present for `emit_block` tools — the `schema_ref` routing key. Null otherwise. */
  emitSchemaRef?: string | null;
  createdAt: string;
};

export type AttachToolResult = {
  attached: boolean;
};

export type DetachToolResult = {
  detached: boolean;
};

// #257 — sub-skill (orchestrator graph) attach/detach results.
export type AttachSkillResult = {
  attached: boolean;
};

export type DetachSkillResult = {
  detached: boolean;
};

export type SkillSecretSummary = {
  id: string;
  key: string;
  createdAt: string;
};

export type SetSkillSecretRequest = {
  key: string;
  value: string;
};

export type SetSkillSecretResult = {
  key: string;
  set: boolean;
};

// --- Admin ---

export type CreateApiKeyRequest = {
  name: string;
  permissions?: string[];
  rateLimit?: number;
  expiresAt?: string;
  /**
   * Tenant slug to bind the new key to. Omit to fall back to the server's
   * default tenant (`t_default`). When set, the resulting key's
   * `tenant_id` column is populated and all calls made with it are
   * automatically scoped to that tenant by the server-side auth middleware
   * — callers never pass `tenant_id` again on subsequent requests.
   */
  tenantId?: string;
};

export type ApiKey = {
  apiKeyId: string;
  name: string;
  permissions: string;
  rateLimit: number;
  tenantId: string | null;
  createdAt: string;
  expiresAt: string | null;
};

export type CreatedApiKey = {
  id: string;
  key: string;
  name: string;
  tenantId: string;
};

export type AdminStats = Record<string, unknown>;
export type CallLogRow = Record<string, unknown>;

export type ScheduledTask = {
  id: string;
  name: string;
  skillId: string;
  prompt: string;
  telegramChatId: number | null;
  schedule: string;
  enabled: number;
  createdAt: string;
  lastRunAt: string | null;
};

export type CreateScheduledTaskRequest = {
  name: string;
  skillId: string;
  prompt: string;
  telegramChatId?: number;
  schedule?: string;
};

export type UpdateScheduledTaskRequest = {
  enabled?: boolean;
  schedule?: string;
  prompt?: string;
};

// --- Eval ---

/**
 * How a saved eval case is scored (T8, #288). `"judge"` is the default
 * LLM-as-judge behaviour (unchanged). `"exact"` / `"contains"` compare the
 * skill's response against `expectedOutput` deterministically (consumed by the
 * T9 scorer). Mirrors the backend `eval_test_cases.match_mode` column.
 */
export type EvalMatchMode = "judge" | "exact" | "contains";

/**
 * 0.32.0 — which guard turn a GUARD-SCOPED eval case exercises. A guard case
 * scores the skill's preflight / postflight guard (its own prompt and model,
 * or its decision-mode pin) instead of the main skill. `null` / absent = an
 * ordinary main-skill case.
 */
export type EvalGuardPhase = "preflight" | "postflight";

export type EvalCase = {
  id: string;
  skillId: string;
  name: string;
  input: string;
  expectedBehavior: string;
  /**
   * Literal reference output for deterministic (`exact`/`contains`) scoring
   * (T9). `null` for judge cases. Mirrors `eval_test_cases.expected_output`.
   */
  expectedOutput?: string | null;
  dimensions: string;
  passingThreshold: number;
  /**
   * Session this case was captured from, when promoted from a captured run
   * (T8). `null` for hand-authored cases. Mirrors
   * `eval_test_cases.source_session_id`. Optional so upgrading from 0.22 stays
   * a non-breaking (additive) type change for consumers that mock `EvalCase`.
   */
  sourceSessionId?: string | null;
  /** How the case is scored. See `EvalMatchMode`. Defaults to `"judge"`. Optional for back-compat. */
  matchMode?: EvalMatchMode;
  /**
   * 0.32.0 — guard phase of a guard-scoped case (see `EvalGuardPhase`); `null`
   * for a main-skill case. Absent only when the server omitted it.
   */
  guardPhase?: EvalGuardPhase | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateEvalCaseRequest = {
  name: string;
  input: string;
  expectedBehavior: string;
  dimensions?: string[];
  passingThreshold?: number;
  /**
   * Literal expected output for deterministic (`exact`/`contains`) cases (T9).
   * Optional — judge cases omit it. Pass `null` to clear an existing value.
   */
  expectedOutput?: string | null;
  /**
   * Capture provenance — the session this case was promoted from (T8).
   * Optional. Omit for hand-authored cases.
   */
  sourceSessionId?: string | null;
  /**
   * Comparison mode for scoring (T8). Optional — omit to let the server apply
   * its default (`"judge"`).
   */
  matchMode?: EvalMatchMode;
  /**
   * 0.32.0 — make this a guard-scoped case (see `EvalGuardPhase`). Omit (or
   * `null`) for a main-skill case. A decision skill's run refuses guard cases
   * (422 `decision_skill_guard_cases_unsupported`).
   */
  guardPhase?: EvalGuardPhase | null;
};

export type RunEvalRequest = {
  skillId: string;
  testCaseIds?: string[];
  promptVersion?: string;
  /**
   * Optional model override for the run (T9, absorbs #288 §D). When set it
   * wins over the skill/integration default model and is recorded into
   * `EvalRun.metadata.model` so two runs are comparable. Omit to use the
   * resolved default.
   */
  modelOverride?: string;
  /**
   * 0.32.0 — which judge grades the run's judged cases. `"llm"` (default) is an
   * LLM judge; `"jev"` is a decision-model judge (TypeSafe Jev by default, or
   * OpenAI Decisions when `judgeIntegrationId` names an OpenAI integration).
   * Frozen per run into `metadata.judge_kind` (see `parseEvalRunMetadata`).
   * Ignored for a decision skill's run, which is graded deterministically.
   */
  judge?: EvalJudgeKind;
  /**
   * 0.32.0 — the judge's model, frozen into `metadata.judge_model`.
   * - `judge: "llm"`: a model of the run's own provider (default: the run's own
   *   model); with `judgeIntegrationId`, a model of THAT integration's provider
   *   (default: the integration's default model) — another provider's model is
   *   400 `judge_model_provider_mismatch`.
   * - `judge: "jev"`: a VERSIONED Jev model id (default `jev-1.13.0`; moving
   *   aliases such as `jev-latest` are rejected), or an OpenAI Decisions model
   *   (default `gpt-6-luna`) when `judgeIntegrationId` names an OpenAI row.
   *   A `jev-*` id without `judge: "jev"` is a 400.
   */
  judgeModel?: string;
  /**
   * 0.32.0 — grade with one of the tenant's own integrations (its id) instead
   * of the run's key. With `judge: "llm"`: an LLM judge on that integration.
   * With `judge: "jev"`: the DECISION integration that grades (a TypeSafe Jev
   * row, or an OpenAI row graded on OpenAI Decisions). Frozen into
   * `metadata.judge_integration_id` / `judge_provider_id` /
   * `judge_key_source`. Tenant `apiKey` only — the admin secret is refused
   * (400 `judge_integration_not_allowed`; admin runs grade on platform keys).
   */
  judgeIntegrationId?: string;
};

// --- Draft-from-event (T8) ---
//
// Resolve a captured `llm_call` (by either half's event id) into a DRAFT eval
// case via `POST /api/v1/eval/draft-from-event`. The draft is HTTP-only —
// NOTHING is persisted. Use the returned fields to prefill a create-case call.
// Admin-secret gated; admin is trusted so any event is resolvable.

/**
 * Options for `client.eval.draftFromEvent()`.
 */
export type DraftFromEventOptions = {
  /**
   * When `true` the server also consults the meta-LLM for a refined draft
   * (populating `assist.suggested`). The copyable assist prompt is returned
   * regardless. Optional — defaults to `false` server-side.
   */
  assist?: boolean;
};

/**
 * LLM context captured alongside the source turn.
 */
export type DraftFromEventLlmContext = {
  model: string | null;
  tokenCount: number;
  latencyMs: number | null;
};

/**
 * Meta-LLM assist payload, present on the draft when `assist: true` was
 * requested. `copyablePrompt` always works (no-LLM fallback); `suggested` is
 * populated only when the meta-LLM ran successfully.
 */
export type DraftFromEventAssist = {
  copyablePrompt: string;
  assisted: boolean;
  suggested?: {
    name: string;
    expectedBehavior: string;
    dimensions: string[];
  };
};

/**
 * A DRAFT eval case derived from a captured LLM call. Nothing is persisted —
 * use these fields to prefill a `client.eval.tests.create()` call.
 */
export type DraftFromEvent = {
  skillId: string;
  sourceSessionId: string | null;
  suggestedName: string;
  input: string;
  referenceOutput: string;
  fullMessages: { role: string; content: unknown }[];
  llmContext: DraftFromEventLlmContext;
  suggestedMatchMode: EvalMatchMode;
  /** Present when `assist: true` was requested. See `DraftFromEventAssist`. */
  assist?: DraftFromEventAssist;
};

export type EvalRunResultSummary = {
  testCaseId: string;
  status: string;
  score: number | null;
  scores: unknown;
  response: string | null;
  reasoning: string | null;
};

export type EvalRunExecution = {
  runId: string;
  status: string;
  totalCases: number;
  passed: number;
  failed: number;
  avgScore: number | null;
  results: EvalRunResultSummary[];
  durationMs: number;
};

export type EvalRun = {
  id: string;
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

// ─── Eval judge / guard / decision metadata (0.32.0) ─────────────────────────

/** Which judge grades a run (`metadata.judge_kind`). */
export type EvalJudgeKind = "llm" | "jev";

/**
 * Whose key graded a run (`metadata.judge_key_source`):
 * - `"tenant_integration"` — the tenant's own Jev key;
 * - `"platform_grant"` — the platform key, via the tenant's platform key grant;
 * - `"platform_admin"` — the platform key, on an admin-secret run;
 * - `"judge_integration"` — the tenant integration named by `judgeIntegrationId`.
 * `null` / absent on an LLM-judged run graded on the run's own key.
 */
export type EvalJudgeKeySource =
  | "tenant_integration"
  | "platform_grant"
  | "platform_admin"
  | "judge_integration";

/**
 * What graded a judged case and what it cost — `_judge` in
 * `EvalRunResult.scoresJson` (both judge kinds; absent on deterministic and
 * error rows). Token counts are `null` when the judge reported none.
 *
 * The decision-judge fields: `score` is the judge's RAW expected level on its
 * 0–4 scale (the stored `EvalRunResult.score` is that value + 1, the 1–5 scale);
 * `argmaxLevel` and the keys of `probabilities` are already on the 1–5 scale.
 */
export type EvalJudgeMeta = {
  provider: EvalJudgeKind;
  /** On a `"jev"`-kind case graded by a decision provider other than TypeSafe Jev. Absent = Jev. */
  decisionProvider?: "openai";
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  rubricVersion?: string;
  score?: number;
  argmaxLevel?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  latencyMs?: number;
};

/**
 * The guard call behind a guard-scoped case (`EvalCase.guardPhase`) — `_guard`
 * in `scoresJson`; absent on main-skill cases. `engine: "chat"` = the guard
 * skill on an LLM; `"decision"` = the pin's decision model (a decision case
 * never falls back to a chat entry).
 */
export type EvalGuardMeta = {
  engine: "chat" | "decision";
  provider: string | null;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  /** Decision engine only. */
  questionsVersion?: string;
  /** Decision engine only. */
  probability?: number;
};

/**
 * The decision call behind a case of a DECISION skill — `_decision` in
 * `scoresJson`; absent on every other case.
 */
export type EvalDecisionMeta = {
  provider: string;
  /** The model id the vendor echoed. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

/**
 * A parsed `EvalRunResult.scoresJson` (see `parseEvalScores`). One flat
 * namespace: judge-authored dimension keys plus `_`-prefixed platform meta.
 */
export type EvalRunResultScores = {
  /** How the verdict was produced: `"judge"`, `"jev"`, `"exact"` or `"contains"`. */
  _scoredBy?: string;
  _judge?: EvalJudgeMeta;
  _guard?: EvalGuardMeta;
  _decision?: EvalDecisionMeta;
  /** The provider transport the case's call used (`"stream"` / `"non_stream"`). */
  _transport?: string;
  /** Present only on a case with an `outputSchema`: did the raw reply satisfy it. */
  _schemaCheck?: EvalSchemaCheck;
  /** `true` only when a `contains` match was reached by unwrapping a root-shape mismatch. */
  _shapeUnwrapped?: true;
  /** Judge-cited quotes not found in the graded response (recorded, never acted on). */
  _evidenceViolations?: EvalJudgeEvidenceViolation[];
  overall?: { score: number; reasoning: string };
  /**
   * Judge-authored dimension scores. Every `_`-prefixed key is reserved for
   * platform meta (dimension names may not start with `_`).
   */
  [dimension: string]: unknown;
};

/** `_schemaCheck` in `scoresJson` — score-neutral record of the case's output-schema check. */
export type EvalSchemaCheck = {
  /** Did the RAW first-shot reply satisfy the schema? */
  valid: boolean;
  /** Present only when a repair pass ran (i.e. `valid` is false). */
  repaired?: boolean;
  /** Present only when the repair was deliberately skipped. */
  repairSkipped?: "reasoning_exhausted_max_tokens";
  /** Why it failed (truncated): the raw reply's failure, then the repair's. */
  errors?: string[];
};

/** One entry of `_evidenceViolations` in `scoresJson`. */
export type EvalJudgeEvidenceViolation = {
  /** The dimension whose evidence carried the quote. */
  dimension: string;
  /** The quote as the judge wrote it (truncated). */
  quote: string;
};

/**
 * A parsed `EvalRun.metadata` (see `parseEvalRunMetadata`). snake_case keys are
 * the stored wire; values are as frozen at run creation. Older runs omit keys
 * that did not exist when they were created.
 */
export type EvalRunMetadata = {
  /** The run's effective model. */
  model?: string;
  provider_id?: string | null;
  judge_model?: string | null;
  /**
   * Which judge graded the run. Known values: `EvalJudgeKind` (`"llm"` |
   * `"jev"`). Typed as `string` because it is stored loosely: the server treats
   * anything other than exactly `"jev"` (including absent, on older runs) as
   * `"llm"`, and so should you.
   */
  judge_kind?: string | null;
  /**
   * Whose key graded the run. Known values: `EvalJudgeKeySource`. `null` /
   * absent on an LLM-judged run graded on the run's own key (and on runs
   * created before the field existed). Typed as `string`: treat an
   * unrecognised value as legacy.
   */
  judge_key_source?: string | null;
  judge_integration_id?: string | null;
  judge_provider_id?: string | null;
  /** How the run's own LLM credentials were resolved. */
  credential_source?: string | null;
  case_timeout_ms?: number;
  prompt_version?: string | null;
  [key: string]: unknown;
};

export type EvalRunResult = {
  id: string;
  runId: string;
  testCaseId: string;
  sessionId: string | null;
  status: string;
  score: number | null;
  scoresJson: string | null;
  response: string | null;
  reasoning: string | null;
  latencyMs: number;
  /**
   * Frozen pre-LLM input snapshot from BaoBox migration 0018 —
   * `{ messages, tools_snapshot, options, secrets_keys }` serialized as JSON.
   * `secrets_keys` contains key NAMES only, never values. Null when the
   * eval execution errored before reaching the LLM call.
   */
  llmInputJson: string | null;
  createdAt: string;
};

export type EvalRunWithResults = EvalRun & {
  results: EvalRunResult[];
};

export type EvalStatsRequest = {
  skillId?: string;
  since?: string;
};

export type EvalStats = {
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

export type EvalFailuresRequest = {
  skillId?: string;
  threshold?: number;
  limit?: number;
};

export type EvalFailureRow = Record<string, unknown>;

export type EvalCompareRequest = {
  skillId: string;
  a: string;
  b: string;
};

export type EvalCompare = {
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

// ─── ContentBlock (0.9.0) ─────────────────────────────────────────────────────
//
// Discriminated union mirroring `baobox/src/shared/types/content-block.ts`.
// Kept in sync manually; bump SDK version on any structural change.
// Addition rule: new block types are added via migration + SDK type bump.
// The `thinking` type is reserved for future reasoning-model use.

export type TextBlock = {
  type: "text";
  text: string;
};

export type ToolUseBlock = {
  type: "tool_use";
  tool_call_id: string;
  name: string;
  input: object;
};

export type ToolResultBlock = {
  type: "tool_result";
  tool_call_id: string;
  output: unknown;
  is_error?: boolean;
};

export type StructuredBlock = {
  type: "structured";
  emit_id: string;
  schema_ref: string;
  data: object;
};

export type RefusalBlock = {
  type: "refusal";
  reason: string;
};

// B1 (epic #170 §3.7): which sandwich-guardrail pass produced the refusal —
// the input-side check ("preflight") or the output-side check on the model's
// draft reply ("postflight"). Shared by the SSE `refusal` event and the
// non-streaming `chat()`/`workflow()` refusal-frame surface.
export type RefusalSurface = "preflight" | "postflight";

export type ThinkingBlock = {
  type: "thinking";
  text: string;
};

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | StructuredBlock
  | RefusalBlock
  | ThinkingBlock;

// ─── SSE event union (0.9.0) ──────────────────────────────────────────────────
//
// One variant per frame type on `text/event-stream`. Data payloads use
// snake_case to match the server wire exactly — do NOT camelCase these.
// See baobox/src/shared/types/sse.ts for the canonical frame name list.

export type SseEvent =
  | { event: "preflight_start"; data: Record<string, never> }
  | { event: "preflight_pass"; data: { latency_ms: number } }
  | { event: "tool_call"; data: { tool_name: string; tool_call_id: string } }
  | { event: "tool_result"; data: { tool_call_id: string; success: boolean; latency_ms: number } }
  | { event: "skill_loaded"; data: { loaded_skill_id: string; loaded_skill_name: string } }
  | { event: "postflight_start"; data: Record<string, never> }
  | { event: "postflight_pass"; data: { attempt: number; latency_ms?: number } }
  | { event: "postflight_block"; data: { reason: string; retry_advisable?: boolean } }
  | { event: "postflight_retry_triggered"; data: { reason: string; retry_hint?: string } }
  | { event: "assistant_message"; data: { content: string; blocks: ContentBlock[] } }
  | { event: "refusal"; data: { reason: string; surface: "preflight" | "postflight" } }
  | { event: "done"; data: { usage?: { input_tokens: number; output_tokens: number }; session_id: string | null } }
  | { event: "heartbeat"; data: Record<string, never> }
  | { event: "error"; data: { code: string; message: string } };

// ─── Per-role guard model config (0.19.0) ────────────────────────────────────
//
// Mirrors BaoBox's `/api/v1/skills/:id/role-models` surface. Each skill has up
// to four model roles; each role supports a chain of up to 4 model entries so
// the runtime can fall back gracefully when the primary model is unavailable.
//
// Bearer/apiKey-gated, tenant-scoped (apiKey tenant implicit; adminSecret
// callers scope via `X-BaoBox-Tenant-Id`). Requires `skills:read` (GET) or
// `skills:write` (PUT).

/**
 * The four functional roles a model can play within a skill's execution.
 *
 * - `"main"` — the primary generation model for the skill's main turn.
 * - `"preflight_guard"` — the model that runs the pre-flight safety check.
 * - `"postflight_guard"` — the model that runs the post-flight safety check.
 * - `"eval_judge"` — the model used as the judge during eval runs.
 */
export type ModelRole = "main" | "preflight_guard" | "postflight_guard" | "eval_judge";

/**
 * 0.32.0 — how a role pin runs. `"chat"` (the default; every pin created
 * before decision models existed) is an LLM call. `"decision"` asks the pinned
 * integration's decision model (TypeSafe Jev or OpenAI Decisions) fixed yes/no
 * guard questions — guard roles only.
 */
export type RoleModelMode = "chat" | "decision";

/**
 * A single model entry in a role's chain, as returned by the server.
 * Position is server-assigned (0-based, ascending order in the chain).
 */
export type SkillRoleModel = {
  skillId: string;
  role: ModelRole;
  /** 0-based position within the chain (server-assigned). */
  position: number;
  /** ID of the LLM integration to use. Null when `llmSource` is `"platform"`. */
  llmIntegrationId: string | null;
  /** Provider-namespaced model id (e.g. `"openai/gpt-5"`). Null to inherit the integration default. */
  model: string | null;
  /** How the model is resolved at runtime. */
  llmSource: "tenant_default" | "platform" | "pinned";
  /**
   * 0.32.0 — how this entry runs (see `RoleModelMode`). Current servers always
   * send it; optional so responses from older servers still type-check.
   */
  mode?: RoleModelMode;
};

/**
 * A single entry in the chain array sent to `PUT /api/v1/skills/:id/role-models`.
 * The server assigns `skillId`, `role`, and `position` — callers only supply the
 * model-selection fields. Chain length is capped at 4 entries server-side.
 *
 * `llmSource: "pinned"` REQUIRES a non-null `llmIntegrationId` — a pinned entry
 * without one is rejected with 400 `invalid_role_model`. To run a model on the
 * tenant's default integration, send `llmSource: "tenant_default"` with
 * `llmIntegrationId: null`.
 */
export type RoleModelChainEntry = {
  llmIntegrationId: string | null;
  model: string | null;
  llmSource: "tenant_default" | "platform" | "pinned";
  /**
   * 0.32.0 — omit to let the server decide: a guard role pinned to a
   * decision-only integration runs `"decision"`; an entry re-sent with the same
   * `llmIntegrationId` as a stored entry keeps that entry's mode; anything else
   * is `"chat"`. When omitted, no `mode` key is sent.
   *
   * Rules for `"decision"`: guard roles only (`preflight_guard` /
   * `postflight_guard`; 422 `decision_mode_not_allowed`); must be
   * `llmSource: "pinned"` with an `llmIntegrationId` (422
   * `decision_mode_requires_integration`) on a decision-capable integration
   * (422 `integration_not_decision_capable`); `model` is `null` (the provider's
   * default, which the server stores) or a versioned decision model id (422
   * `invalid_decision_model`); decision entries must come before chat entries
   * in a chain (422 `decision_after_chat`). A `"chat"` entry cannot pin a
   * decision-only integration (422 `integration_not_chat_capable`).
   */
  mode?: RoleModelMode;
};

/**
 * Returned by `client.skills.roleModels.get()`. Maps each `ModelRole` to its
 * current chain of model entries.
 */
export type SkillRoleModelsMap = Record<ModelRole, SkillRoleModel[]>;

// ─── LLM catalog (0.18.0) ────────────────────────────────────────────────────
//
// Read-only mirror of the server's `/api/v1/llm-providers` response.
// ADMIN_SECRET-gated — an apiKey-only client receives 401 (same posture
// as `/api/v1/tools`). The catalog is non-tenant, static-ish metadata.
//
// Wire shape mirrors ProviderView / ModelInfo from the BaoBox server.

export type LlmCatalogModelPricing = {
  /** Cost in USD per million input tokens. */
  inputUsdPerMTok: number;
  /** Cost in USD per million output tokens. */
  outputUsdPerMTok: number;
  /** ISO date the pricing was last recorded (e.g. "2026-06-01"). */
  asOf: string;
  /** 0.32.0 — prompt-cache read (cache hit) price per million tokens, when published. */
  cacheReadUsdPerMTok?: number;
  /**
   * 0.32.0 — a vendor-announced price change not yet in effect. The numbers
   * above stay authoritative until `effectiveFrom` (`YYYY-MM-DD`).
   */
  scheduled?: {
    effectiveFrom: string;
    inputUsdPerMTok: number;
    outputUsdPerMTok: number;
    cacheReadUsdPerMTok?: number;
  };
};

/**
 * 0.32.0 — a vendor-announced shutdown of a catalogued model id. The entry
 * stays in the catalog until `shutsDownOn`.
 */
export type ModelDeprecation = {
  /** `YYYY-MM-DD`, as stated by the vendor. */
  shutsDownOn: string;
  /** The vendor's named replacement, when it names one. */
  replacement?: string;
};

/**
 * 0.32.0 — what a provider (and so an LLM integration of that provider) can be
 * used for. `"chat"` runs chat skills; `"decision"` answers typed questions
 * with probabilities (decision skills, decision-mode guards, the decision
 * judge).
 */
export type ProviderUse = "chat" | "decision";

/**
 * 0.32.0 — one decision model a decision-capable provider offers.
 * `versioned` = an id a skill, guard pin or eval run may freeze (never a moving
 * alias).
 */
export type DecisionModelView = {
  id: string;
  displayName: string;
  pricing: LlmCatalogModelPricing;
  versioned: boolean;
  deprecation?: ModelDeprecation;
};

export type LlmCatalogModel = {
  /** Provider-namespaced model id (e.g. "openai/gpt-5"). */
  id: string;
  displayName: string;
  /** Whether the model exposes sampling or reasoning parameters. */
  paramProfile: "sampling" | "reasoning";
  /**
   * Reasoning effort tiers this model accepts. Present when
   * `paramProfile === "reasoning"`; absent otherwise.
   */
  reasoningEfforts?: string[];
  /** Maximum context window in tokens, if known. */
  contextWindow?: number;
  /** Pricing snapshot, if available. */
  pricing?: LlmCatalogModelPricing;
  /** 0.32.0 — vendor-announced shutdown, when one is scheduled. */
  deprecation?: ModelDeprecation;
};

export type LlmCatalogProvider = {
  /** Provider slug used in model ids (e.g. "openai"). */
  id: string;
  displayName: string;
  /** Default model id for this provider as configured in BaoBox. */
  defaultModel: string;
  docsUrl: string;
  pricingUrl: string;
  models: LlmCatalogModel[];
  /** 0.32.0 — what this provider can be used for. Absent on older servers. */
  uses?: ProviderUse[];
  /**
   * 0.32.0 — the provider's decision models, when it is decision-capable
   * (e.g. the OpenAI provider's OpenAI Decisions model).
   */
  decisionModels?: DecisionModelView[];
};

/**
 * Returned by `client.catalog.list()`. Contains all providers BaoBox knows
 * about and the global list of valid reasoning-effort tier strings.
 */
export type LlmCatalog = {
  providers: LlmCatalogProvider[];
  /** All reasoning-effort tier strings valid across all providers. */
  reasoningEfforts: string[];
  /**
   * 0.30.0 — the model a skill created without `model` is stored with.
   * Optional: absent on servers that predate the field.
   */
  platformDefaultModel?: string;
};

// ─── LLM integrations (0.20.0) ───────────────────────────────────────────────
//
// Tenant-scoped, API-safe view of the integrations a tenant has configured.
// Readable via `skills:read`-gated bearer (apiKey or adminSecret).
//
// `GET /api/v1/llm-integrations`         → { data: LlmIntegration[] }
// `GET /api/v1/llm-integrations/:id/models` → { data: IntegrationModelsView }
//
// The list response is API-SAFE — no real API keys are returned; the server
// masks secrets as `"***"` in `apiKeyMask`. Do NOT add an `apiKey` field here.

/**
 * API-safe view of a tenant's configured LLM integration, as returned by
 * `GET /api/v1/llm-integrations`. The real credential is never exposed —
 * only the masked hint (`apiKeyMask`) is present.
 *
 * Requires a key with `skills:read`. Tenant-scoped: an apiKey client's
 * tenant is implicit; an adminSecret client passes `{ tenantId }`.
 */
export type LlmIntegration = {
  /** Integration id (e.g. `"int_abc123"`). The server also sends it as `integrationId`. */
  id: string;
  /** 0.32.0 — the same value as `id` (the server sends both). */
  integrationId?: string;
  displayName: string;
  /** Provider slug (e.g. `"openai"`, `"anthropic"`). */
  provider: string;
  /**
   * Provider-namespaced default model id (e.g. `"openai/gpt-5"`), or `null`
   * when none is set. 0.32.0 widened this from `string`: decision-only rows
   * are always `null`, and a chat row may be.
   */
  defaultModel: string | null;
  /** 0.32.0 — tenant-added model ids on this integration (empty = none). */
  customModels?: string[];
  /** Whether this is the tenant's default integration. */
  isDefault: boolean;
  /**
   * 0.32.0 — what this integration can be used for, derived from its provider.
   * A row without `"chat"` is never a tenant default, a chat skill's
   * integration or a `main` role pin. Absent on older servers.
   */
  uses?: ProviderUse[];
  /** Masked credential hint — always `"***"`. Never the real key. */
  apiKeyMask: string;
};

/**
 * 0.32.0 — options for `llmIntegrations.list()`.
 */
export type LlmIntegrationListOptions = {
  /** Admin-secret clients: the tenant to list for (`X-BaoBox-Tenant-Id`). */
  tenantId?: string;
  /**
   * Which rows to return (`?use=`). The server default is `"chat"` (rows that
   * can run chat skills); `"decision"` returns decision-capable rows;
   * `"any"` returns every row. Omitted → no query string is sent. Any other
   * value is a 400 `INVALID_QUERY`.
   */
  use?: "chat" | "decision" | "any";
};

/**
 * A single model entry within an `IntegrationModelsView`, combining static
 * catalog metadata with provider-live availability.
 */
export type IntegrationModel = {
  /** Provider-namespaced model id (e.g. `"openai/gpt-5"`). */
  id: string;
  displayName: string;
  /** Where this model entry originates: static catalog, provider-live list, or custom. */
  source: "catalog" | "provider" | "custom";
  /** Whether the model exposes sampling or reasoning parameters. */
  paramProfile: "sampling" | "reasoning";
  /**
   * Reasoning effort tiers this model accepts. Present when
   * `paramProfile === "reasoning"`; absent otherwise.
   */
  reasoningEfforts: string[];
  /** Pricing snapshot, if available from the catalog. */
  pricing: LlmCatalogModelPricing | null;
  /** 0.32.0 — vendor-announced shutdown (catalog entries only). */
  deprecation?: ModelDeprecation;
};

/**
 * Returned by `client.llmIntegrations.listModels()`. Contains the full model
 * list for one integration, combining catalog data with any provider-live
 * models. If the provider list fetch failed, `providerListError` is non-null.
 *
 * Requires a key with `skills:read`. Tenant-scoped.
 */
export type IntegrationModelsView = {
  integrationId: string;
  /** Provider slug (e.g. `"openai"`). */
  provider: string;
  models: IntegrationModel[];
  /** Non-null when the server could not fetch the live provider model list. */
  providerListError: string | null;
  /**
   * 0.32.0 — present when the integration's provider is decision-capable. A
   * decision-only integration has `models: []` and only these.
   */
  decisionModels?: DecisionModelView[];
};

// ─── ChatStreamRequest (0.9.0) ────────────────────────────────────────────────

/** Request shape for `client.chatStream()`. Same fields as `ChatRequest`. */
export type ChatStreamRequest = {
  skillId?: string;
  message: string;
  sessionId?: string;
  metadata?: JsonObject;
  attachments?: AttachmentInput[];
};

// ─── Direct tool invocation (M4 endpoint, SDK 0.5.0) ─────────────────────────

/**
 * Request body for `client.tools.invoke()`. Dispatches a builtin tool by
 * name through `POST /api/v1/tools/invoke`. The supplied API key must be
 * either tenant-bound to `tenantId` or a cross-tenant admin-issued key.
 */
export type ToolInvokeRequest = {
  /** Builtin tool name registered in BaoBox's catalog (e.g. "send_email"). */
  tool: string;
  /** Caller's tenant scoping. The handler resolves any per-tenant integration internally. */
  tenantId: string;
  /** Tool-specific input payload. Validated server-side by the handler's Zod schema. */
  inputs: JsonObject;
};

/**
 * Response from a successful tool invocation. Failures throw `BaoBoxError`
 * (status 500); validation/scoping issues throw with status 400/403.
 */
export type ToolInvokeResponse = {
  /** Audit-row identifier (`tcl_...`). Persists in `tool_calls` for later inspection. */
  toolCallId: string;
  /** Always "SUCCESS" on the resolved promise — failures throw. */
  status: "SUCCESS";
  /** Handler-specific result payload. Shape depends on the tool. */
  result: unknown;
  meta: ResponseMeta;
};
