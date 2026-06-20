# Changelog

## 0.22.0

`catalog.list()` and `tools.list()` now work on an apiKey-only client (the Skill Studio BFF).

### Fixed

- `catalog.list()` (`GET /api/v1/llm-providers`) and `tools.list()`
  (`GET /api/v1/tools`) previously used the **adminSecret** request path
  (`requestAdmin`). An apiKey-only client (no `ADMIN_SECRET` — e.g. the Skill
  Studio BFF) therefore failed these calls, surfacing as a 500 on the skill
  page's auto-loaded `/models` and `/tools` requests. Both now use
  `requestSkills`, which sends the apiKey when the client has no admin secret
  (and the admin secret otherwise). Backend routes are apiKey-readable: the
  catalog via `tenantReadAuth` (#330), the tool list via the matching backend
  change (tenant apiKey → own + global tools; admin → all).
- **Non-breaking**: an adminSecret client behaves identically (requestSkills
  resolves to the admin secret when present). Tool `create`/`delete` remain
  adminSecret-gated.

## 0.21.0

Pin a tenant LLM integration on a skill — `llmIntegrationId` on skill create/update (#337 PR-B).

### Added

- `SkillCreateRequest.llmIntegrationId?: string | null` — pin a specific tenant
  LLM integration on the skill (the model runs on that integration's
  provider/key). Pass `null` to clear the pin and revert to the tenant default.
  Tenant-scoped; the key's tenant must own the integration (server returns 4xx
  otherwise).
- `SkillUpdateRequest` inherits the field automatically (it is
  `Partial<SkillCreateRequest>`).
- `buildSkillWriteBody` forwards `llmIntegrationId` in the PUT/POST body when
  set; `null` is preserved (not stripped) so the clear-pin path works.

### Notes

**ADDITIVE-ONLY** — no existing fields renamed or removed. All prior SDK methods
and types are unchanged.

---

## 0.20.0

Tenant LLM integration reads — `client.llmIntegrations` (#330 PR-2).

### Added

- `client.llmIntegrations.list(options?)` — fetches
  `GET /api/v1/llm-integrations` and returns the unwrapped `LlmIntegration[]`
  array. **API-safe**: no real credentials are returned; the server masks
  secrets as `"***"` in `apiKeyMask`. Requires `skills:read`.
- `client.llmIntegrations.listModels(integrationId, options?)` — fetches
  `GET /api/v1/llm-integrations/:id/models` and returns the unwrapped
  `IntegrationModelsView` (models from catalog + provider live list, plus
  `providerListError` when the upstream fetch fails). Requires `skills:read`.
- Both methods use the dual-auth skills path (`requestSkills`): adminSecret
  when available, otherwise the apiKey. Tenant-scoped via `options.tenantId`
  (`X-BaoBox-Tenant-Id` header); on an apiKey client the key's tenant is
  implicit and `options` may be omitted.
- New public types (all exported from the package root):
  - `LlmIntegration` — API-safe integration row: `{ id, displayName, provider, defaultModel, isDefault, apiKeyMask }`.
  - `IntegrationModel` — per-model entry: `{ id, displayName, source, paramProfile, reasoningEfforts, pricing }`.
  - `IntegrationModelsView` — `{ integrationId, provider, models, providerListError }`, returned by `listModels()`.

### Notes

**ADDITIVE-ONLY** — no existing fields renamed or removed. All prior SDK methods are unchanged.

The Skill Studio BFF can now call `client.llmIntegrations.list()` and
`client.llmIntegrations.listModels()` with its per-tenant apiKey to power an
integration-first model picker — no cross-tenant admin secret needed in the BFF.

## 0.19.0

Per-role guard model config — `client.skills.roleModels` (#328 PR-2).

### Added

- `client.skills.roleModels.get(skillId, options?)` — fetches
  `GET /api/v1/skills/:id/role-models` and returns the unwrapped
  `Record<ModelRole, SkillRoleModel[]>` map. Requires `skills:read`.
- `client.skills.roleModels.put(skillId, { role, chain }, options?)` — writes
  `PUT /api/v1/skills/:id/role-models` and returns the unwrapped
  `{ role: ModelRole, chain: SkillRoleModel[] }` for the updated role.
  Requires `skills:write`. Chain length is capped at 4 entries server-side.
- Both methods use the dual-auth skills path (`requestSkills`): adminSecret
  when available, otherwise the apiKey. Tenant-scoped via `options.tenantId`
  (`X-BaoBox-Tenant-Id` header); on an apiKey client the key's tenant is
  implicit and `options` may be omitted.
- New public types (all exported from the package root):
  - `ModelRole` — `"main" | "preflight_guard" | "postflight_guard" | "eval_judge"`.
  - `SkillRoleModel` — full server-side shape: `{ skillId, role, position, llmIntegrationId, model, llmSource }`.
  - `RoleModelChainEntry` — PUT input shape (no `skillId`/`role`/`position`; server assigns those).
  - `SkillRoleModelsMap` — `Record<ModelRole, SkillRoleModel[]>`, returned by `roleModels.get()`.

### Notes

**ADDITIVE-ONLY** — no existing fields renamed or removed. All prior SDK methods are unchanged.

The Skill Studio BFF can now call `client.skills.roleModels.get/put()` with its
per-tenant apiKey to read and update the guard model chain without needing the
cross-tenant admin secret.

## 0.18.0

Model catalog surface — `client.catalog.list()` (#320 PR-B).

### Added

- `client.catalog.list(): Promise<LlmCatalog>` — fetches `GET /api/v1/llm-providers`
  and returns the unwrapped `{ providers, reasoningEfforts }` payload. **ADMIN_SECRET-gated**:
  an apiKey-only client will receive 401 (same posture as `/api/v1/tools`). The catalog
  is non-tenant, static metadata; no request body is sent.
- New public types (all exported from the package root):
  - `LlmCatalog` — top-level return shape: `{ providers: LlmCatalogProvider[], reasoningEfforts: string[] }`.
  - `LlmCatalogProvider` — `{ id, displayName, defaultModel, docsUrl, pricingUrl, models }`.
  - `LlmCatalogModel` — `{ id, displayName, paramProfile, reasoningEfforts?, contextWindow?, pricing? }`.
  - `LlmCatalogModelPricing` — `{ inputUsdPerMTok, outputUsdPerMTok, asOf }`.

### Notes

**ADDITIVE-ONLY** — no existing fields renamed or removed. All prior SDK methods are unchanged.

The Skill Studio BFF can now call `client.catalog.list()` to replace its hand-kept static
provider list with the live server catalog. Requires a BaoBox server with the
`GET /api/v1/llm-providers` endpoint merged.

## 0.17.0

Additive model-config surface — `reasoningEffort` on skills (#301).

### Added

- `ReasoningEffort` type: `"none" | "minimal" | "low" | "medium" | "high" |
  "xhigh"`. Exported from the package root. These are the OpenAI-API
  reasoning-effort tiers; **which values a given model accepts is
  model-dependent** (`"minimal"` → some gpt-5/mini/nano variants; `"none"` /
  `"xhigh"` → newer gpt-5.x variants that drop `"minimal"`). The SDK exposes
  the full set; per-model validity is enforced server-side.
- `SkillCreateRequest.reasoningEffort?: ReasoningEffort` — optionally set the
  reasoning effort when creating or updating a skill. `compactObject` drops it
  when `undefined`, so existing callers that don't pass it see no wire change.
- `SkillUpdateRequest` inherits the field via `Partial<SkillCreateRequest>`.
- `Skill.reasoningEffort?: ReasoningEffort | null` — read back on skill
  responses. Optional so pre-#301 server responses (which omit the field)
  remain compatible.

### Notes

**ADDITIVE-ONLY** — no existing fields renamed or removed. Wire shape is
unchanged for callers that do not pass `reasoningEffort`.

**Author-vs-read-only decision**: `reasoningEffort` is the only new field
surfaced as author-able in this release. Per-role model config (e.g. a
dedicated model for the preflight guard vs the main turn) and fallback model
chains are server/portal-side concerns — the platform manages them without SDK
input. The SDK exposes those fields as read-only mirrors only once the server
contract stabilises; that work is tracked as a follow-on to #301.

> Requires a server with #301 support to persist `reasoningEffort`. Against
> an older server the field is forwarded on write (harmlessly ignored) and
> absent on reads — no breakage.

## 0.16.0

Tenant-scoped skill **authoring** over the per-tenant `apiKey` (#257, Skill
Studio Phase 2).

### Added

- `client.skills.create(req, { tenantId })` now uses the dual-auth skills path
  (adminSecret **or** apiKey). With an apiKey the new skill is **tenant-owned**;
  an unscoped adminSecret client still creates a global skill (unchanged).
- `client.skills.attachSkill` / `detachSkill` / `listAttachedSkills` — the
  orchestrator sub-skill graph.
- `client.skills.attachTool` / `detachTool` / `listTools` — tool wiring against
  the new `/api/v1/skills/:id/tools/*` routes. This **lifts the "tools require
  adminSecret" restriction**: an apiKey client may attach tools on its key's
  allowlist (server-enforced; off-list → 403, cross-tenant tool → 403).
- All new methods accept `{ tenantId }`; on an apiKey client the key's tenant is
  implicit and the server forces ownership.

### Notes

- `skills.create` on an **apiKey** client rejects a `tools` field up front (use
  `skills.attachTool`) so a create can never half-succeed.
- Requires a BaoBox server with #257 worker support (tenant key grants
  `skills:create` / `skills:attach` / `skills:tools` + a `tool:<id>` allowlist).

## 0.15.0

Per-tenant credential for the admin skill surface (#254 AC1).

### Added

- `client.skills.list`, `client.skills.get`, and `client.skills.update` now
  authenticate with an **`apiKey`** when the client has no `adminSecret`
  (previously these were `adminSecret`-only). This lets the Skill Studio BFF
  construct an `apiKey`-only client scoped to a single tenant, instead of
  holding the cross-tenant `adminSecret`. When both `apiKey` and `adminSecret`
  are present the `adminSecret` is preferred, so existing admin tooling is
  unchanged. The `X-BaoBox-Tenant-Id` scope header is still sent in both modes.
- Unit tests asserting the apiKey is used (and the tenant header sent) for an
  apiKey-only client, and that adminSecret wins when both are supplied.

> Requires a BaoBox server with #254 worker support: a tenant-bound API key
> carrying `skills:read` / `skills:write` authorized for the skill routes.
> Backward compatible — adminSecret clients behave exactly as in 0.14.0.

## 0.14.0

Tenant-scoped admin skill reads/writes (#247) — the Skill Studio BFF enabler.

### Added

- `SkillScopeOptions` and an optional trailing `options?: { tenantId }` on
  `client.skills.list`, `client.skills.get`, and `client.skills.update`. When
  supplied the SDK sends the `X-BaoBox-Tenant-Id` header so an admin-secret
  client can act on behalf of exactly one tenant: `list` returns that tenant's
  skills plus global system skills, and `get` / `update` return 404 (not 403)
  for a skill owned by another tenant. Mirrors `sessions.create({ tenantId })`
  (0.13.0). Omitting it preserves the cross-tenant (global) behaviour, so this
  is fully backward compatible.
- Unit tests asserting the scope header is sent on list/get/update when
  supplied and omitted when not.

> Requires a BaoBox server with the #247 worker support (it reads
> `X-BaoBox-Tenant-Id` on the admin skills routes). Against an older server the
> header is ignored and the call behaves as unscoped — no breakage.

## 0.13.0

Multi-tenant session creation (#239).

### Added

- `SessionCreateRequest.tenantId?` — `client.sessions.create({ skillId,
  tenantId })` now binds the new session to a tenant. The SDK sends it as
  the `tenantId` body field; the server stores it on the session and echoes
  it back on `Session.tenantId`. Previously the SDK dropped all tenant
  information on create, forcing multi-tenant consumers (e.g. NexionOps) to
  bypass the SDK with raw `fetch()` calls and hand-roll the
  `X-BaoBox-Tenant-Id` header — which also exposed them to the raw JSON wire
  shape the SDK normally normalises.
- Unit tests asserting the `tenantId` body field is sent when supplied,
  omitted when not, and surfaced on the returned `Session`.

> Requires a BaoBox server that reads `tenantId` on `POST /api/v1/sessions`
> (baobox #239). Older servers ignore the field and return an unscoped
> session.

## 0.12.0

Hardens the B1 + D1 surfaces that landed in 0.11.0.

### Fixed

- `client.skills.updateGuardrails()` now targets
  `PATCH /api/v1/admin/skills/:id/guardrails` instead of
  `/api/v1/skills/:id/guardrails`, which does not exist on the server.
  The 0.11.0 release would have returned 404 for every call. The wire
  body still carries only `preflightAddendum` / `postflightAddendum` —
  the admin route accepts addenda alone without touching the disabled
  flags, matching the tenant-safe contract.

### Added

- Unit tests covering the three new methods (request shape, URL encoding,
  bearer auth, error propagation) plus the `Session.metadata` /
  `Event.actorUserId` mapper behaviour for both modern and pre-D1
  server responses.
- README sections documenting the B1 guardrail config surfaces and the
  D1 session metadata + per-staff attribution flow.

### Notes

The SDK is bearer-only (no cookie surface). The tenant-portal cookie route
`/api/v1/tenant-session/skills/:id/guardrails` is unreachable from this
package by design — see the JSDoc on `updateGuardrails` for the rationale.

## 0.11.0

B1 guardrail config surfaces + D1 per-staff attribution and session metadata.
Both features were landed in the backend as part of Epic #170 (Chat Platform).
This release is a **pure type-surface + method addition** — no breaking changes
to existing callers.

### Added

#### B1 — Sandwich guardrail configuration

- `EventType` union extended with eleven new guardrail event strings:
  `preflight_pass`, `preflight_block`, `postflight_pass`, `postflight_redact`,
  `postflight_block`, `postflight_retry_triggered`, `postflight_retry_exhausted`,
  `postflight_retry_skipped_side_effects`, `guardrail_disabled`,
  `refusal_emitted`, `injection_detected`. These appear on the session timeline
  whenever the sandwich guard runs.
- `SkillGuardrailUpdateRequest` / `SkillGuardrailUpdateResult` — tenant-scoped
  addenda-only request/response types.
- `AdminSkillGuardrailUpdateRequest` / `AdminSkillGuardrailUpdateResult` —
  admin-only request/response types that also carry `preflightDisabled` /
  `postflightDisabled` kill-switch flags.
- `client.skills.updateGuardrails(skillId, req)` — PATCH
  `/api/v1/skills/:id/guardrails`. Sets `preflightAddendum` /
  `postflightAddendum` on a tenant-owned skill. Attempting to set
  `*_disabled` flags via this path returns 400 from the server.
- `client.admin.skills.setGuardrailDisabled(skillId, req)` — PATCH
  `/api/v1/admin/skills/:id/guardrails`. Admin-only surface that can set
  flags and/or addenda on any skill (including system skills).

#### D1 — Per-staff attribution + session metadata

- `Session.metadata?: JsonObject | null` — arbitrary JSON metadata blob on
  the session. Null until the first `updateMetadata()` call. Optional so
  pre-D1 server responses remain compatible.
- `SessionMetadataUpdateRequest` / `SessionMetadataUpdateResult` — request
  and response types for the metadata PATCH.
- `client.sessions.updateMetadata(sessionId, metadata)` — PATCH
  `/api/v1/sessions/:id/metadata`. Body must be a plain JSON object; the
  server enforces a 65 536-byte cap.
- `Event.actorUserId?: string | null` — email of the tenant user who
  triggered the turn. Present on timeline events emitted by authenticated
  tenant paths; null on admin/sandbox paths; field is absent on pre-D1
  server responses (optional so older servers don't break the mapper).

### Migration

Back-compatible. Existing callers see no change. To adopt:

```ts
// B1 — set a preflight addendum on a skill
await client.skills.updateGuardrails('sk_a', {
  preflightAddendum: 'Only answer questions about invoices.',
});

// B1 — disable a guardrail node (admin only)
await client.admin.skills.setGuardrailDisabled('sk_a', {
  postflightDisabled: true,
});

// D1 — attach metadata to a session
await client.sessions.updateMetadata('ses_abc', {
  staffUserId: 'usr_123',
  clientRef: 'client_xyz',
});

// D1 — read actorUserId from a session timeline event
const { events } = await client.sessions.timeline('ses_abc');
for (const ev of events) {
  if (ev.actorUserId) console.log('triggered by', ev.actorUserId);
}
```

## 0.10.1

Adds `latency_ms` to the `postflight_pass` SSE frame type. Backend
baobox#200 surfaces real `latency_ms` on `postflight_pass` frames (the
`preflight_pass` shape already carried it since 0.9.0).

### Added

- `postflight_pass` data variant now includes `latency_ms?: number`.
  **Optional** — 0.9.0/0.10.0 backends omit it; required typing would break
  client-side null safety against older backends during rollout.
- README frame table updated to show the new field with the backend version
  note.

No runtime SDK change — `chatStream()` already passes frame data through
verbatim and the SDK has no `postflight_pass` normalization.

## 0.10.0

Producer side for structured blocks — `emit_block` tools. The consumer half
(`ContentBlock` / `chatStream()`) shipped in 0.9.0; this release surfaces the
producer-side type so a skill can be configured to emit `structured` blocks.
The backend has supported this end-to-end since the ContentBlock contract
landed — 0.10.0 is a **pure type-surface widening + wire pass-through**, no
behaviour change.

### Added

- `ToolHandlerType` now includes `"emit_block"` (was `"builtin" | "http"`). An
  emit_block tool is a server-side no-op: BaoBox validates the model's call args
  against the tool's `inputSchema` and packages them into a `structured`
  `ContentBlock` (`{ type:"structured", emit_id, schema_ref, data }`).
- `ToolCreateRequest.emitSchemaRef?: string | null` — the routing key stamped
  onto the emitted block's `schema_ref`. Required for `emit_block` tools,
  ignored otherwise. **Free-form** — there is no schema registry; the payload is
  validated against `inputSchema` (root object, `additionalProperties:false` at
  every level, every property in `required`, no `$ref`, no root `oneOf`).
  Defaults to the tool `name` server-side when omitted. `ToolUpsertRequest`
  inherits the field.
- `Tool.emitSchemaRef?: string | null` — round-tripped on reads (`tools.get` /
  `tools.list`); null for non-emit tools.

### Migration

Back-compatible. Existing `builtin` / `http` tool callers see no change.

```ts
await client.tools.create({
  name: 'emit_summary_card',
  description: 'Emit a summary card as a structured block.',
  inputSchema: { type: 'object', additionalProperties: false, /* … */ },
  handlerType: 'emit_block',
  handlerConfig: {},
  emitSchemaRef: 'summary_card_v1',
});
// The skill lists this tool in `tools:` with no `output_schema`. When the model
// calls it, the consumer sees a `structured` block with
// schema_ref === 'summary_card_v1' and the validated payload in `data`.
```

## 0.9.0

SSE streaming chat — `client.chatStream()` + `ContentBlock` + `SseEvent` types.

### Added

- `ContentBlock` discriminated union (`text | tool_use | tool_result | structured | refusal | thinking`) mirroring the server's canonical block schema. Exported from the package root.
- `SseEvent` discriminated union — one variant per SSE frame type (`preflight_start`, `preflight_pass`, `tool_call`, `tool_result`, `skill_loaded`, `postflight_start`, `postflight_pass`, `postflight_block`, `postflight_retry_triggered`, `assistant_message`, `refusal`, `done`, `heartbeat`, `error`). Data payloads are snake_case to match the server wire exactly.
- `ChatStreamRequest` type (same fields as `ChatRequest`).
- `client.chatStream(req: ChatStreamRequest): AsyncIterable<SseEvent>` — zero-dependency SSE consumer built on `fetch + ReadableStream`. POSTs to `/api/v1/chat/stream` with `Accept: text/event-stream`. The `timeoutMs` deadline fires only until response headers arrive; the stream itself may live for the full LLM turn.

### Implementation notes

- Uses `response.body.getReader()` + `TextDecoder` with a string buffer split on `\n\n`. Handles multi-frame chunks and partial chunks correctly.
- Non-200 responses throw `BaoBoxError` (same error-mapping as `chat()`).
- Zero new runtime dependencies.

### Migration

Back-compatible. Existing `chat()` / `workflow()` callers see no change.

```ts
for await (const ev of client.chatStream({ skillId: 'sk_a', message: 'hello' })) {
  switch (ev.event) {
    case 'assistant_message':
      console.log(ev.data.content);
      break;
    case 'tool_call':
      console.log('tool:', ev.data.tool_name, ev.data.tool_call_id);
      break;
    case 'done':
      console.log('session:', ev.data.session_id);
      break;
  }
}
```

## 0.8.1

Regression fix on `client.tools.invoke()` shipped in 0.8.0.

### What broke

`/api/v1/tools/invoke` is an **API-key-gated public-SDK endpoint**, not
part of the admin/operator surface that flipped to camelCase in the
BaoBox `ι` (iota) epic. The server schema on that route still uses
snake_case (`tenant_id`, `tool_call_id`). SDK 0.8.0 incorrectly bundled
it into the admin hard-cutover and sent `tenantId` on the wire — every
`client.tools.invoke()` call against a 0.8.0 SDK got a 400 from the
server (`tenant_id: Invalid input: expected string, received undefined`).
The response unpack was also broken (`body.data.toolCallId` was
undefined because the server emits `tool_call_id`).

### Fix

Revert `invokeTool` to the byte-identical 0.7.x wire shape for both
request and response. No other surface changes — every other admin
mapper from 0.8.0 stays camelCase.

If BaoBox eventually flips `/api/v1/tools/invoke` to camelCase, it would
need a `#142`-style dual-emit deprecation window (the route is on the
public-SDK boundary), and the SDK mapping moves with it in lockstep.

### Migration

Back-compatible. Apps that depend on `client.tools.invoke()` should
upgrade `@baobox/sdk` to `0.8.1` and remove any direct-`fetch`
workarounds they applied for this endpoint while 0.8.0 was broken.

## 0.8.0

Two coordinated wire-shape changes against the BaoBox server, both shipped
together because 0.8.0 has not been published yet.

### Public-SDK boundary (`chat()` + `workflow()`) — dual-shape compat

The server emits public `/api/v1/workflow` and `/api/v1/chat` responses in
BOTH camelCase (preferred) AND snake_case (deprecated) during a Phase-1
deprecation window. This release lets the SDK parse both so applications
stay forward-compatible when the server eventually drops snake (Phase 3,
future release).

- `chat()` and `workflow()` SEND camelCase on the wire (`skillId`,
  `sessionId`, `clientId`, `requestId`, `outputSchema`). The server accepts
  either shape but logs a deprecation telemetry row whenever the snake form
  is used — this opts every SDK user out of that noise immediately.
- Response parsers prefer camelCase fields and fall back to snake_case so
  the SDK works against a Phase-1 server (both shapes), a Phase-3 server
  (camelCase only), and the legacy pre-Phase-1 server (snake only).
- Error envelope parser reads `error.requestId` first, falls back to
  `error.request_id`.

### Admin surface — hard cutover to camelCase

The BaoBox admin / operator surface (`/api/v1/skills`, `/api/v1/tools`,
`/api/v1/sessions`, `/api/v1/admin/*`, `/api/v1/eval/*`) silently flipped
from snake_case to camelCase in the server's `ι` (iota) epic, but no SDK
release went out alongside. SDK 0.7.x silently returned objects with
`undefined` IDs (e.g. `skill.id === undefined` on `client.skills.list()`),
which broke caller-side name→id resolution paths in the field.

This release rewires every admin/operator mapper to read camelCase. Unlike
the public-SDK boundary above, there's no dual-read fallback — the server
admin surface has been camelCase-only for several weeks already, so a
fallback layer would be dead code.

Mappers updated (every read site flipped to camelCase, request bodies
flipped to camelCase, `id` rewired to the entity-specific key the server
now emits — `skillId`, `toolId`, `eventId`, `evalCaseId`, `evalRunId`,
`evalRunResultId`, `taskId`, `apiKeyId`, `skillSecretId`, `skillFileId`,
`messageId`, `sessionId`, `callLogId`):

- `mapSession`, `mapSessionMessage`, `mapEvent`
- `mapSkill`, `mapSkillWithFiles`, `mapSkillFileSummary`, `mapSkillFile`
- `mapTool`, `mapSkillSecretSummary`
- `mapScheduledTask`
- `mapEvalCase`, `mapEvalRunExecution`, `mapEvalRunResultSummary`,
  `mapEvalRun`, `mapEvalRunResult`, plus `getEvalStats` / `compareEvalVersions`
- `mapWorkflowRunSummary`, `getRunTimeline`, `listRuns`, `appendRunEvent`
- `createApiKey` (response body)
- `invokeTool` (response body)

Outbound bodies likewise flipped to camelCase (`createTool`, `createSession`,
`createApiKey`, `createScheduledTask`, `createEvalTest`, `runEval`,
`appendRunEvent`, `buildSkillWriteBody`). The `id` field of the SDK-level
domain types (`Skill.id`, `Tool.id`, etc.) is unchanged — only the wire
mapping was wrong.

Attachment metadata fields (`att_id`, `mime_type`, `bytes_base64`,
`parse_strategy`, etc.) intentionally stay snake_case — that wire is
covered by the §10.2 external-metadata carve-out and the server still
expects/emits the snake form.

### Migration

Back-compatible at the SDK public-API surface. Applications using `bb.chat()`,
`bb.workflow()`, `bb.skills.*`, `bb.tools.*`, `bb.sessions.*`, etc. need no
code change. Acceptance check for the admin surface:

```ts
const skills = await bb.skills.list();
console.log(skills.map((s) => s.id)); // every entry must be a non-empty `sk_…`
```

### Why

The server-side migration ships a ~2-week deprecation window where both
shapes are accepted on inbound and both are emitted on outbound for the
public boundary. Phase 3 (snake removed on public boundary) is gated on
telemetry confirming integrator traffic has fully moved to camelCase. The
admin/operator surface ships hard-cutover because (1) it has been
camelCase-only for several weeks already, (2) the SDK was the only known
consumer still on snake-only reads, and (3) every existing consumer of the
old snake API was already broken before this release.

## 0.7.1

Admin-secret callers can now mint API keys bound to a specific tenant
via `admin.keys.create({ ..., tenantId })`. The corresponding
server-side schema accepts the field; omitting it preserves the
previous behaviour of falling back to `t_default`.

### Added

- `CreateApiKeyRequest.tenantId?: string`. When set, the new key's
  `tenant_id` column is populated and every subsequent call made
  with the key is automatically tenant-scoped by the server-side
  auth middleware — callers never pass `tenant_id` again on
  follow-up requests.
- README "Multi-tenant usage" section documenting the
  one-client-per-tenant pattern, how to mint a tenant-bound key,
  and the small set of admin paths that accept a per-request
  `tenantId`.

### Migration

Back-compatible. Existing callers that don't pass `tenantId` see no
change — `compactObject` strips the undefined field before the request
body is serialised.

```ts
const created = await admin.admin.keys.create({
  name: "my-tenant-local-dev",
  tenantId: "my_tenant_slug",
});
```

## 0.7.0

`parse_strategy`-aware helpers on top of the 0.6.0 `attachments[]`
contract. The L3 LlamaParse fallback chain is now live server-side
(BaoBox η.2 / B-5), so callers can deliberately route an attachment
through a tier without restructuring the rest of the request.

### Added

- `attachmentWithStrategy(att, strategy)` standalone export and
  `client.attachments.withStrategy(att, strategy)` namespaced form.
  Returns a NEW `AttachmentInput` with `parseStrategy` overridden;
  preserves every other field. Pure — never mutates the input.

### When to use which strategy

| Strategy       | What BaoBox does                                                                       | Use when                                                                            |
| -------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `auto`         | Server picks based on mime + skill defaults (`filename` → `extract_text` → `llamaparse`). | Default. You don't have a strong opinion and trust the chain.                       |
| `filename`     | Records metadata only — never reads bytes.                                              | You only need a paper trail (e.g. "client sent us this") and no parse cost.         |
| `extract_text` | L2 text-only path (PDF text extraction, `.txt`, basic docx).                            | Layout doesn't matter and cost matters. Skips the L3 hop on a known text PDF.       |
| `llamaparse`   | L3 high-fidelity via LlamaParse Cloud (OCR, tables, multimodal).                        | Image-heavy PDFs, scanned documents, table-dense statements. Requires a tenant LlamaParse integration row. |

### Re-exports

- `ParseStrategy` continues to be re-exported from the package root
  (`export type * from "./types.js"`).

### Migration

Back-compatible. Existing callers that don't touch `parseStrategy`
see no change.

```ts
const base = bb.attachments.fromUrl({
  url: "https://your-r2.example.com/signed/abc.pdf",
  filename: "statement.pdf",
  mimeType: "application/pdf",
});

// Pin to L3 when you know the document is image-heavy.
const pinned = bb.attachments.withStrategy(base, "llamaparse");
```

## 0.6.0

Structured workflow support + per-request `attachments[]` contract.

### Structured workflow

- Added `outputSchema` to `workflow()` requests.
- Added optional structured `output` to `workflow()` responses.
- Added `workflowStructured()` for callers that want the SDK to require
  validated structured output.
- Preserved the raw `response` alongside `output` for debugging and
  trace correlation.
- Added tests and README examples covering structured workflow usage.

### Attachments

- New `attachments?: AttachmentInput[]` field on `workflow()` and `chat()`.
  Mirrors BaoBox's per-request inbound attachment contract (master plan
  §3.1): three source kinds — `url` (signed-URL fetch on the server),
  `inline` (base64-encoded bytes, ≤ 5 MB after decode), and `baobox_ref`
  (re-use a previously-uploaded BaoBox object by `att_id`).
- New `ParseStrategy` enum: `"auto" | "filename" | "extract_text" |
  "llamaparse"`. Defaults to `"auto"` server-side when omitted. The
  SDK passes the enum through but ships no LlamaParse-specific helpers
  in this release (that's `0.7.0`).
- New builders, exposed both as standalone exports and via
  `client.attachments.*`:
    - `attachmentFromUrl({ url, filename?, mimeType?, sizeBytes?,
      checksumSha256?, auth?, parseStrategy? })`
    - `attachmentFromInline({ bytes, filename?, mimeType?,
      parseStrategy? })` — base64-encodes the bytes and pre-checks
      the 5 MB cap so callers fail fast.
    - `attachmentFromRef({ attId, filename?, mimeType?, sizeBytes?,
      parseStrategy? })`
- `MAX_INLINE_BYTES = 5 * 1024 * 1024` exported for parity with the
  server-side `413 ATTACHMENT_TOO_LARGE` cap.
- New `examples/attachment-smoke.ts` demonstrating the three source
  kinds against a local BaoBox dev server.

### Migration

Both additions are back-compatible — existing callers that don't pass
`outputSchema` or `attachments` see no behaviour change. To adopt:

```ts
const res = await bb.workflow({
  skill: "sk_email_chase",
  clientId: "client_abc",
  requestId: "req_42",
  input: "summarise this statement",
  attachments: [
    bb.attachments.fromUrl({
      url: "https://your-r2.example.com/signed/abc.pdf",
      filename: "statement.pdf",
      mimeType: "application/pdf",
    }),
  ],
});
```

### Publishing

`npm publish` is currently a manual step from a clean `main` checkout —
the publish CI for `@baobox/sdk` is tracked under BaoBox **B-9**.
