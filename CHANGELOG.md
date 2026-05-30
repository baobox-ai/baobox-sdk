# Changelog

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
