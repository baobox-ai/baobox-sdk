# @baobox/sdk

TypeScript HTTP client for [BaoBox](https://baobox.ai) — an AI integration platform providing an agent runtime, eval engine, and observability trail.

This package is a thin wrapper around BaoBox's REST API. It has zero business logic — all intelligence lives server-side. Making it public removes friction for partners and third-party users while keeping the runtime closed.

## Installation

```bash
npm install @baobox/sdk
# or
pnpm add @baobox/sdk
```

Requires Node.js 18+ (relies on native `fetch`).

## Quick start

```typescript
import { BaoBoxClient } from "@baobox/sdk";

const bb = new BaoBoxClient({
  endpoint: "https://api.baobox.ai",
  apiKey: process.env.BAOBOX_API_KEY,
  adminSecret: process.env.BAOBOX_ADMIN_SECRET,
});

const res = await bb.chat({
  skillId: "sk_document_chaser",
  message: "Review cli_01 and take whatever action is needed.",
  sessionId: "ses_cli_01",
});

console.log(res.response);          // "Sent chase email for bank_statement, payroll..."
console.log(res.meta.requestId);    // "req_abc123" — matches server log
console.log(res.meta.trace);        // [{ toolName, input, output, latencyMs }, ...]
```

## Streaming chat

`client.chatStream()` returns an `AsyncIterable<SseEvent>` that yields one typed event per SSE frame. Use it when you need live progress (tool calls, postflight retries, streaming token delivery) rather than waiting for the full response.

```typescript
import { BaoBoxClient } from "@baobox/sdk";

const bb = new BaoBoxClient({
  endpoint: "https://api.baobox.ai",
  apiKey: "sk_a",   // your API key
});

for await (const ev of bb.chatStream({ skillId: "sk_a", message: "hi" })) {
  switch (ev.event) {
    case "preflight_start":
      console.log("checking…");
      break;
    case "tool_call":
      // snake_case per server wire — do NOT camelCase
      console.log("tool:", ev.data.tool_name, ev.data.tool_call_id);
      break;
    case "tool_result":
      console.log("result:", ev.data.tool_call_id, ev.data.success, ev.data.latency_ms);
      break;
    case "skill_loaded":
      console.log("sub-skill:", ev.data.loaded_skill_name);
      break;
    case "assistant_message":
      // ev.data.blocks is ContentBlock[] — authoritative final set
      console.log(ev.data.content);
      for (const block of ev.data.blocks) {
        if (block.type === "text") console.log(block.text);
        if (block.type === "structured") console.log(block.schema_ref, block.data);
      }
      break;
    case "refusal":
      console.warn("refusal:", ev.data.reason, ev.data.surface);
      break;
    case "done":
      console.log("session:", ev.data.session_id, "tokens:", ev.data.usage);
      break;
    case "error":
      console.error(ev.data.code, ev.data.message);
      break;
    case "heartbeat":
      // keepalive — no action needed
      break;
  }
}
```

### SSE frame payload shapes (snake_case)

| Event | Key fields |
|---|---|
| `preflight_start` | — |
| `preflight_pass` | `latency_ms: number` |
| `tool_call` | `tool_name: string`, `tool_call_id: string` |
| `tool_result` | `tool_call_id: string`, `success: boolean`, `latency_ms: number` |
| `skill_loaded` | `loaded_skill_id: string`, `loaded_skill_name: string` |
| `postflight_pass` | `attempt: number`, `latency_ms?: number` *(present on backend 0.9.1+)* |
| `postflight_block` | `reason: string`, `retry_advisable?: boolean` |
| `postflight_retry_triggered` | `reason: string`, `retry_hint?: string` |
| `assistant_message` | `content: string`, `blocks: ContentBlock[]` |
| `refusal` | `reason: string`, `surface: "preflight" \| "postflight"` |
| `done` | `session_id: string \| null`, `usage?: { input_tokens, output_tokens }` |
| `heartbeat` | — |
| `error` | `code: string`, `message: string` |

### Timeout behaviour

`timeoutMs` (default 30 000 ms) applies only until the response headers arrive. Once the stream begins, no second timeout is applied — a long LLM turn will not be cut off mid-stream.

## Multi-tenant usage

BaoBox is a multi-tenant system, but the SDK deliberately has no
`tenantId` constructor field: tenant is an attribute of the API key,
and the server-side auth middleware resolves it on every request. In
multi-tenant deployments use **one client instance per tenant**:

```typescript
const tenantClient = new BaoBoxClient({
  endpoint: process.env.BAOBOX_URL!,
  apiKey: process.env.BAOBOX_TENANT_KEY!,  // tenant-bound key
});

await tenantClient.chat({
  skillId: "sk_xxx",
  message: "...",
});
// The server scopes every call to this key's tenant automatically;
// cross-tenant access returns a 403 BaoBoxError.
```

### Minting a tenant-bound key

Admin-secret holders can target a specific tenant when issuing a key
(added in 0.8.0):

```typescript
const admin = new BaoBoxClient({
  endpoint: process.env.BAOBOX_URL!,
  adminSecret: process.env.BAOBOX_ADMIN_SECRET!,
});

const created = await admin.admin.keys.create({
  name: "my-tenant-local-dev",
  tenantId: "my_tenant_slug",   // omit to fall back to t_default
});

console.log(created.key);       // "skb_..." — hand this to the tenant
console.log(created.tenantId);  // "my_tenant_slug"
```

The tenant slug must already exist in BaoBox's `tenants` table; tenant
provisioning is handled by BaoBox operators through a separate ops
path.

### Cross-tenant admin paths

A small number of admin-only APIs accept a per-request `tenantId`
field for cross-tenant dispatch (`tools.invoke()`, `workflow()`,
`runs.list()`). These are admin-secret gated — key-bound callers
always remain scoped to the tenant their key is bound to and cannot
override it.

The admin skill reads/writes also accept an optional tenant scope
(`skills.list`, `skills.get`, `skills.update`), mirroring
`sessions.create({ tenantId })`:

```typescript
// Cross-tenant (default): every skill.
await bb.skills.list();

// Scoped: this tenant's skills + global system skills.
await bb.skills.list({ tenantId: "t_acme" });

// 404 (not 403) if sk_x is owned by another tenant; global skills stay visible.
await bb.skills.get("sk_x", { tenantId: "t_acme" });
await bb.skills.update("sk_x", { description: "edited" }, { tenantId: "t_acme" });
```

The SDK sends the scope as the `X-BaoBox-Tenant-Id` header. This is what the
Skill Studio BFF (`@baobox/skill-builder-bff`) uses to act on behalf of exactly
one tenant. Requires a server with the #247 worker support.

A scoped `skills.update` / `skills.delete` acts only on a skill OWNED by that
tenant: another tenant's skill or a global skill returns 404. Only an unscoped
admin call (no `tenantId`) can edit or delete a global skill.

Creating a skill (`skills.create`, `skills.import`) on an admin client needs an
explicit owner (0.33.0+): `{ tenantId }` for a tenant-owned skill, or
`{ global: true }` (sent as `X-BaoBox-Global: true`) for a platform-global one.
With neither, the server answers 400 and the SDK throws `BaoBoxError` — it never
defaults to global. Pass one or the other, not both (a type error).
`skills.save` / `admin.skills.upsert` accept the same options when they create a
new skill; when they update (`req.id` set), `tenantId` is the write scope and
`global` is ignored.

```typescript
await bb.skills.import({ url: "https://example.com/SKILL.md" }, { tenantId: "t_acme" });
await bb.skills.create({ name: "Shared helper", systemPrompt: "..." }, { global: true });
```

## API surface

### Chat

```typescript
const res = await bb.chat({
  skillId: "sk_chase",
  message: "...",
  sessionId: "ses_1",                         // optional
  metadata: { source: "kanban" },             // optional, forwarded to trace
});
```

Returns `{ response, usage: { inputTokens, outputTokens }, sessionId, content, blocks, refusalSurface, meta }` where `content` (0.32.0+) holds the turn's content blocks when the server sent any (text, tool calls, `structured` blocks, a decision skill's answer); `blocks` and `refusalSurface` are set only on a guardrail refusal (`blocks` = a single `refusal` block); and `meta` carries `requestId`, `latencyMs`, `model`, an optional `transport` (`"stream"` / `"non_stream"` — how BaoBox called the model provider, 0.31.0+), an optional `trace` array, and (0.33.0+) the response headers `requestIdHeader` (`X-Request-Id`) and `traceparent` (see [Export traces to OpenTelemetry](#export-traces-to-opentelemetry--added-in-0330)).

### Workflow (single-turn, stateless) — added in 0.3.0

`workflow()` is the right call when the caller already owns conversation state and doesn't want BaoBox to persist a session/thread. The full conversation history is passed every call; BaoBox just runs the skill on it once and returns. Events are written under a server-generated `runId` so you can fetch the trace later.

```typescript
const res = await bb.workflow({
  skill: "sk_email_chase",
  clientId: "client_abc",                  // your tenant's client identifier
  requestId: "your_app_req_42",            // your tenant's request identifier
  input: "chase client for missing bank statements",
  history: [                               // optional
    { role: "user", content: "draft an email..." },
    { role: "assistant", content: "Sure, here's a draft..." },
  ],
});

console.log(res.response);   // skill output
console.log(res.runId);      // "wflow_..." — handle for the run's event timeline
```

Returns `{ response, runId, usage, meta }` (`meta` as for `chat()`, including `transport`). `clientId` and `requestId` land on the BaoBox `call_logs` row (as `client_id` and `external_request_id`) so you can join workflow runs back to your own request log. The skill is responsible for self-routing — there is no `action` discriminator on the request.

### Workflow (structured output) — added in 0.6.0

When the caller needs machine-consumable output, supply `outputSchema`.
BaoBox will parse / validate / repair the model output server-side and
return validated `output` alongside the raw `response`.

```typescript
const res = await bb.workflowStructured<{
  subject: string;
  body: string;
  missingItemsEchoed: string[];
}>({
  skill: "sk_email_chase",
  clientId: "client_abc",
  requestId: "your_app_req_42",
  input: "draft a chase email",
  outputSchema: {
    type: "object",
    required: ["subject", "body", "missingItemsEchoed"],
    additionalProperties: false,
    properties: {
      subject: { type: "string" },
      body: { type: "string" },
      missingItemsEchoed: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
});

console.log(res.output.subject);
console.log(res.response); // raw assistant text retained for debugging
```

`workflow()` also accepts the optional `outputSchema` field and will
surface `output` when present. Use `workflowStructured()` when you want
the SDK to enforce that structured output exists.

### Sending attachments — added in 0.6.0

Both `workflow()` and `chat()` accept an optional `attachments` array.
Each entry carries a `source` (one of three kinds) plus parse routing
metadata. Bytes are never returned in responses; BaoBox writes an
`attachment_received` event onto the run/session timeline with metadata
only.

```typescript
const res = await bb.workflow({
  skill: "sk_email_chase",
  clientId: "client_abc",
  requestId: "your_app_req_42",
  input: "summarise this statement",
  attachments: [
    // Most common: a signed URL on your own R2 bucket.
    bb.attachments.fromUrl({
      url: "https://your-r2.example.com/signed/abc.pdf",
      filename: "statement.pdf",
      mimeType: "application/pdf",
      checksumSha256: "<64-char-lower-hex>",   // optional — enables BaoBox's parse cache
    }),

    // Inline base64 (≤ 5 MB after decode). The helper encodes for you
    // and rejects oversize payloads up-front.
    bb.attachments.fromInline({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: "page-2.png",
      mimeType: "image/png",
    }),

    // Re-use a previously-uploaded BaoBox object.
    bb.attachments.fromRef({
      attId: "att_abc123def456",
      filename: "earlier.pdf",
    }),
  ],
});
```

`parseStrategy` is optional and defaults to `"auto"` server-side
(BaoBox picks `filename` → `extract_text` → `llamaparse` based on
mime type and per-tenant configuration). Pass an explicit value to
pin a tier:

```typescript
bb.attachments.fromUrl({
  url: "...",
  parseStrategy: "extract_text",   // skip the L3 fallback
});
```

The builders are pure — there's no network call until the parent
`workflow()` / `chat()` runs. They're also re-exported as standalone
functions (`attachmentFromUrl`, `attachmentFromInline`,
`attachmentFromRef`) for callers who don't want to construct a client
just to shape an attachment.

### Choosing a parse strategy — added in 0.7.0

`parseStrategy` controls the tier BaoBox uses to read an attachment.
Leaving it as `"auto"` (the default) lets the server pick based on
mime type, skill configuration, and tenant defaults — that's the
right answer most of the time. Pin a tier when the caller has
information the server doesn't (e.g. "this PDF is a scanned image,
skip L2").

| Strategy       | What BaoBox does                                                                       | Use when                                                                            |
| -------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `auto`         | Server picks based on mime + skill defaults (`filename` → `extract_text` → `llamaparse`). | Default. You don't have a strong opinion and trust the chain.                       |
| `filename`     | Records metadata only — never reads bytes.                                              | You only need a paper trail (e.g. "client sent us this") and no parse cost.         |
| `extract_text` | L2 text-only path (PDF text extraction, `.txt`, basic docx).                            | Layout doesn't matter and cost matters. Skips the L3 hop on a known text PDF.       |
| `llamaparse`   | L3 high-fidelity via LlamaParse Cloud (OCR, tables, multimodal).                        | Image-heavy PDFs, scanned documents, table-dense statements. Requires a tenant LlamaParse integration row. |

`client.attachments.withStrategy(att, strategy)` returns a new
attachment with `parseStrategy` overridden — the original is left
untouched. Useful when the same builder output is reused across
calls but a single dispatch wants a different tier:

```typescript
const base = bb.attachments.fromUrl({
  url: "https://your-r2.example.com/signed/abc.pdf",
  filename: "statement.pdf",
  mimeType: "application/pdf",
});

const cheap     = bb.attachments.withStrategy(base, "extract_text");
const highFi    = bb.attachments.withStrategy(base, "llamaparse");
```

Also exported as a standalone `attachmentWithStrategy(att, strategy)`
for callers who don't want a client instance.

### Sessions, Skills, Tools, Eval, Admin

BaoBox now splits auth:

- `apiKey` is only for `chat`
- `adminSecret` is for `sessions`, `skills`, `tools`, `eval`, and `admin`

```typescript
const session = await bb.sessions.create({ skillId: "sk_chase" });

// Multi-tenant consumers: bind the session to a tenant (#239) so it is
// scoped server-side and cannot read another tenant's data.
const scoped = await bb.sessions.create({ skillId: "sk_chase", tenantId: "t_123" });
// scoped.tenantId === "t_123"

const history = await bb.sessions.messages(session.id);
const timeline = await bb.sessions.timeline(session.id);

const skill = await bb.skills.create(
  {
    name: "Document Chaser",
    systemPrompt: "...",
    tools: ["lookup_client_docs"], // SDK convenience: syncs attachments after create
  },
  // An adminSecret client must say who owns the new skill: { tenantId } or,
  // for a platform-global skill, { global: true } — not both. Neither → 400
  // (0.33.0+). skills.save / admin.skills.upsert take the same options.
  { tenantId: "t_123" },
);

const tool = await bb.tools.create({
  name: "lookup_client_docs",
  description: "...",
  inputSchema: { type: "object" },
  handlerType: "http",
  handlerConfig: { url: "https://backend.example.com/tools/lookup" },
});

const run = await bb.eval.run({ skillId: skill.id });
const stats = await bb.admin.stats.get();
```

### Provider transport — added in 0.31.0

`llmTransport` on `skills.create` / `skills.update` chooses how BaoBox calls the model provider for that skill: `"auto"` (default — streams from the provider when the call's max tokens is 15 000 or more), `"stream"` (requests streaming on every call; a provider that cannot stream still runs non-streaming), or `"non_stream"`. `null` on update goes back to `auto`. The server stores `auto` as `null`, so a skill reads back `null | "stream" | "non_stream"`. What actually happened is reported per call as `res.meta.transport`.

```typescript
await bb.skills.update("sk_report", { llmTransport: "stream" });
const res = await bb.workflow({ skill: "sk_report", clientId: "c", requestId: "r1", input: "..." });
res.meta.transport; // "stream" | "non_stream" | undefined (older servers)
```

### Decision skills — added in 0.32.0

A decision skill answers a fixed list of typed questions (yes/no, pick-one, score) about the message it is given, on a decision model (TypeSafe Jev or OpenAI Decisions), and returns one JSON object instead of text. It must pin a decision-capable integration (`llmIntegrations.list({ use: "decision" })`); `model` is a versioned decision model id or omitted for the provider's default; `systemPrompt` is a preamble of at most 4000 characters. The kind cannot change after create.

```typescript
import { decisionOutputOf, type DecisionSkillOutput } from "@baobox/sdk";

const skill = await bb.skills.create({
  name: "Inbound triage",
  systemPrompt: "You triage inbound customer email.",
  skillKind: "decision",
  llmIntegrationId: "int_decision",            // a TypeSafe Jev or OpenAI integration
  decisionSpec: {
    version: 1,
    questions: [
      { id: "urgent", type: "boolean", prompt: "Does this need a reply today?" },
      {
        id: "topic",
        type: "choice",
        prompt: "What is it about?",
        options: [
          { value: "billing", description: "Invoices, payments, refunds" },
          { value: "other", description: "Anything else" },
        ],
      },
    ],
  },
});

// /workflow: `output` is the answer object.
const res = await bb.workflow<DecisionSkillOutput>({
  skill: skill.id, clientId: "c", requestId: "r1", input: "My invoice is wrong again!",
});
res.output?.answers.urgent;   // { type: "boolean", value: true, probability: 0.912, threshold: 0.5 }

// /chat: the answer is a `structured` block in `turn.content` (schema_ref "baobox.decision.v1").
const turn = await bb.chat({ skillId: skill.id, message: "My invoice is wrong again!" });
decisionOutputOf(turn)?.answers.topic;   // { type: "choice", value: "billing", ... }
```

`DecisionSkillOutput` is `{ kind: "decision", version: 1, skillId, provider, model, answers, usage: { input_tokens, output_tokens }, latency_ms }`; the snake_case inside it is the payload contract, not an envelope field. `answers` follow the spec's question order. A decision skill refuses `outputSchema`, files, tools, sub-skills and a `main` role-model pin (422s), and its postflight guard never runs.

### Decision models, integrations and role-model `mode` — added in 0.32.0

```typescript
// Integrations: default = rows that can run chat skills; ask for others with `use`.
const decisionRows = await bb.llmIntegrations.list({ use: "decision" }); // or "any"
decisionRows[0]?.uses;          // ["decision"]
decisionRows[0]?.defaultModel;  // null — `defaultModel` is now `string | null`

// Models of a decision-capable integration.
const view = await bb.llmIntegrations.listModels("int_decision");
view.decisionModels;            // [{ id, displayName, pricing, versioned, deprecation? }]

// Run the preflight guard on a decision model.
await bb.skills.roleModels.put("sk_support", {
  role: "preflight_guard",
  chain: [{ llmIntegrationId: "int_decision", model: null, llmSource: "pinned", mode: "decision" }],
});
```

`mode: "decision"` is accepted on `preflight_guard` / `postflight_guard` only, must pin a decision-capable integration, and must come before any chat entries in the chain. Omit `mode` to let the server keep or infer it. Note that `llmSource: "pinned"` always requires a non-null `llmIntegrationId` (400 `invalid_role_model`); to run a model on the tenant's default integration send `{ llmIntegrationId: null, model, llmSource: "tenant_default" }`.

### Eval judge selection — added in 0.32.0

```typescript
import { parseEvalScores, parseEvalRunMetadata } from "@baobox/sdk";

// LLM judge on one of the tenant's own integrations (tenant apiKey only).
await bb.eval.run({ skillId: "sk_support", judgeIntegrationId: "int_judge", judgeModel: "gpt-5.4" });

// Decision-model judge (TypeSafe Jev by default; OpenAI Decisions with an OpenAI row).
const started = await bb.eval.run({ skillId: "sk_support", judge: "jev" });

const run = await bb.eval.runs.get(started.runId);
parseEvalRunMetadata(run).judge_kind;            // "jev"
parseEvalScores(run.results[0] ?? null)?._judge; // { provider, model, inputTokens, ... }
```

`judge` defaults to `"llm"`; the choice is frozen per run (`judge_kind`, `judge_model`, `judge_key_source`, `judge_integration_id`, `judge_provider_id` in the run metadata). The admin secret cannot use `judgeIntegrationId` (400 `judge_integration_not_allowed`). A decision skill's run is graded deterministically (`exact` / `contains` cases only) and ignores the judge fields. Guard-scoped cases are created with `eval.tests.create(skillId, { ..., guardPhase: "preflight" })` and record `_guard` in `scoresJson`.

### Backward compatibility

```typescript
await bb.admin.skills.upsert({
  id: "sk_chase",
  name: "Document Chaser",
  systemPrompt: "...",
  model: "gpt-5",
  tools: ["lookup_client_docs", "send_client_email"],
});

await bb.admin.tools.upsert({
  name: "lookup_client_docs",
  description: "...",
  inputSchema: { type: "object", properties: { /* ... */ } },
  handlerType: "http",
  handlerConfig: { url: "https://backend.example.com/tools/lookup", /* ... */ },
});
```

`bb.admin.skills.upsert()` now targets `/api/v1/skills` and, when `tools` is provided, reconciles the skill's tool attachments via the dedicated tool-association endpoints. `bb.admin.tools.upsert()` now targets `/api/v1/tools`.

### Guardrail configuration (B1) — added in 0.11.0, fixed in 0.12.0

BaoBox runs a "sandwich" guard around every chat turn — a pre-flight classifier
inspects the input before the main skill runs, and a post-flight reviewer
inspects the candidate output before it leaves the server. Both guards can
have tenant-customised addenda injected into their system prompts. Only an
admin can flip the kill-switches that disable a guard entirely.

```typescript
// Set the pre-flight addendum on a skill. Tenant-safe surface — addenda only.
await bb.skills.updateGuardrails("sk_demo", {
  preflightAddendum: "Only answer questions about the customer's invoices.",
  postflightAddendum: null, // clear any previous post-flight addendum
});

// Admin-only kill-switches. Set `preflightDisabled` / `postflightDisabled` to
// bypass a guard entirely. Works on system skills (e.g. `sk_sys_preflight_v1`)
// too. Can also set addenda in the same call.
await bb.admin.skills.setGuardrailDisabled("sk_demo", {
  postflightDisabled: true,
  preflightAddendum: "Refuse anything outside the invoice domain.",
});
```

The new event types appear on the session timeline whenever the sandwich
fires: `preflight_pass`, `preflight_block`, `postflight_pass`,
`postflight_redact`, `postflight_block`, `postflight_retry_triggered`,
`postflight_retry_exhausted`, `postflight_retry_skipped_side_effects`,
`guardrail_disabled`, `refusal_emitted`, `injection_detected`.

```typescript
const timeline = await bb.sessions.timeline("ses_demo");
for (const event of timeline.events) {
  if (event.eventType === "preflight_block") {
    console.warn("blocked at preflight", event.metadata);
  }
}
```

Both methods hit `PATCH /api/v1/admin/skills/:id/guardrails` (the only
bearer-gated guardrail route the server exposes). The tenant-portal cookie
path is not reachable from this SDK — `client.skills.updateGuardrails()`
omits the disabled flags from the body so the admin route only touches
addenda, matching the tenant contract.

### Session metadata + per-staff attribution (D1) — added in 0.11.0

Sessions carry an arbitrary JSON metadata blob (capped at 65 536 bytes
serialized). Set it via `sessions.updateMetadata()`:

```typescript
await bb.sessions.updateMetadata("ses_demo", {
  staffUserId: "usr_demo",
  clientRef: "client_demo",
});

const session = await bb.sessions.get("ses_demo");
// session.metadata === { staffUserId: "usr_demo", clientRef: "client_demo" }
```

`Session.metadata` is `JsonObject | null | undefined`. `null` means the
metadata column was explicitly cleared; `undefined` (field absent on the
wire) means a pre-D1 server response — treat both as "no metadata set".

Events on the session timeline now carry `actorUserId` — the email of the
tenant user who triggered the turn. Null on admin/sandbox paths; absent on
pre-D1 server responses (the SDK omits the field from the parsed event when
the server didn't send it, so older servers stay compatible).

```typescript
const timeline = await bb.sessions.timeline("ses_demo");
for (const event of timeline.events) {
  if (event.actorUserId) {
    console.log(event.eventType, "by", event.actorUserId);
  }
}
```

### Events (timeline alias)

```typescript
const events = await bb.events.list({ sessionId: "ses_1" });
```

Each `Event` carries `sessionId: string | null` and `runId: string | null` (added in 0.3.0). Chat events have `sessionId` set; workflow events have `runId` set. Both share the same shape so a single consumer can render either timeline.

### Runs (workflow trace + human-in-the-loop) — added in 0.4.0

Wraps `/api/v1/admin/runs/*`, the admin surface for workflow-run observability. Three things you can do:

1. **Get a run's full timeline** — every LLM call, tool call, error, plus any caller-pushed human/external events under the same `run_id`:

```typescript
const timeline = await bb.runs.get("wflow_abc123");
//   timeline.runId  = "wflow_abc123"
//   timeline.events = Event[] in chronological order
```

2. **List recent workflow runs** — typically scoped to one tenant client so a front-end can render an "AI activity" tab per business client:

```typescript
const runs = await bb.runs.list({
  clientId: "cli_01HXYZ",
  since: "2026-04-01T00:00:00Z",
  limit: 25,
});
```

3. **Append a human-in-the-loop or external lifecycle event** onto a run's timeline. The five accepted types are `human_review_started`, `human_approved`, `human_rejected`, `external_send`, `external_reply_received`. The runtime-only types (`llm_call_*`, `tool_*`, `*_message`, `error`) are emitted by BaoBox itself and are rejected if a caller pushes them.

```typescript
await bb.runs.appendEvent("wflow_abc123", {
  eventType: "human_approved",
  content: "Looks good — sending.",
  metadata: { staff_user: "alice", reviewed_at: new Date().toISOString() },
});
```

Append-event is the lightweight way to make a run's trace tell the full story: BaoBox writes the AI events; your backend writes the human/external events; the timeline interleaves them by `created_at` so the rendered trace shows the complete sequence (draft → human review → approve → external send → reply received → assess) without a thread abstraction.

### Export traces to OpenTelemetry — added in 0.33.0

`runs.exportOtlp` and `sessions.exportOtlp` (admin secret) return a run's or a
session's trace as an OpenTelemetry OTLP/JSON `ExportTraceServiceRequest`. The
body is returned exactly as the server sent it, so you can POST it unchanged to
any OTLP/HTTP JSON endpoint (`/v1/traces`).

```typescript
const otlp = await bb.runs.exportOtlp("wflow_abc123");
// or: await bb.sessions.exportOtlp("ses_1", { includeContent: true });

await fetch(`${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(otlp),
});
```

The same with `curl`:

```bash
curl -s -H "Authorization: Bearer $BAOBOX_ADMIN_SECRET" \
  "$BAOBOX_ENDPOINT/api/v1/admin/runs/$RUN_ID/export?format=otlp" \
| curl -s -X POST "$OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces" \
    -H "content-type: application/json" --data-binary @-
```

- **Shape.** A run is one trace: an `invoke_workflow` root, a `chat` span per
  LLM call, an `execute_tool` span per tool call. A session is one trace per
  request, each rooted at `invoke_agent` with `gen_ai.conversation.id` = the
  session id, plus one more trace for events recorded without a request id
  (e.g. Telegram turns).
- **Content is off by default.** The export carries metadata only: no prompts,
  completions, tool arguments or results, error text, or end-user identity.
  `{ includeContent: true }` (`include_content=1`) adds them, and every such
  string passes through the server's secret scrubber first. Event metadata is
  exported from a per-event allowlist, so unknown keys are withheld.
- **Semantic conventions.** Attribute names follow the OpenTelemetry GenAI
  semantic conventions as of 2026-10. Those are experimental: names may change.
- **Timestamps are reconstructed at flush time.** BaoBox stamps event times
  when it flushes a batch of events, so span durations come from measured
  latencies and a trace's child spans are laid out one after another from
  those stamps. Read them as approximate wall-clock times. The resource says
  so with `baobox.timestamps = "flush_time"`. Forward the export promptly:
  backends limit how old an ingested span may be.

**Distributed tracing with `traceparent`.** Pass your W3C `traceparent` on
`chat()`, `chatStream()` or `workflow()` and BaoBox stores it with the call. The
request's OTLP export then uses your trace id, and its root span (kind SERVER)
names your span as its parent. Nothing joins your trace until you forward the
export to your collector.

```typescript
const res = await bb.workflow({
  skill: "sk_chase", clientId: "c_1", requestId: "ext_1", input: "...",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
});
res.meta.traceparent;     // "00-4bf92f…4736-<BaoBox span id>-01" (BaoBox's echo)
res.meta.requestIdHeader; // the X-Request-Id response header

for await (const ev of bb.chatStream({
  sessionId: "ses_1", // needed for the turn to be exportable (see below)
  message: "...",
  traceparent: "00-…-01",
  onResponseMeta: (m) => console.log(m.traceparent, m.requestIdHeader),
})) { /* frames */ }
```

- The echo is a **BaoBox convention**: W3C defines no response header. It
  carries your trace id, BaoBox's span id for this request (the export's root
  span) and only your sampled bit. Record it as a span link or a lookup key.
- An absent or invalid `traceparent` is ignored (never an error) and gets no
  echo. The SDK sends your value verbatim and does not validate it.
- The sampled bit does not affect storage or export.
- In a session export each request is its own trace. Requests that carried
  the same `traceparent` trace id share that one trace, each as its own
  BaoBox root.
- A `chat()` / `chatStream()` turn with no `sessionId` stores and echoes your
  trace context but belongs to no session or run, so no export reaches it —
  pass a `sessionId` when you need it exported.
- Only `chat()` / `chatStream()` (with a `sessionId`) and `workflow()` first
  attempts produce an exportable span under your trace id. An `Idempotency-Key` replay echoes the
  replay's own span id, and the export keeps the original attempt's trace.
  The batch workflow API does not take a `traceparent`.
- Server-to-server only for now: BaoBox's CORS policy does not yet allow a
  `traceparent` request header or expose the echo, so a cross-origin browser
  call that sets `traceparent` fails its preflight. Send it from your backend.

### Tools (direct invocation) — added in 0.5.0

`bb.tools.invoke()` dispatches a builtin BaoBox tool through `POST /api/v1/tools/invoke` without going through the skill runtime. This is the path workflow apps use after a human approves an action — the LLM produces a draft, the human approves, your code calls the tool directly.

```typescript
const result = await bb.tools.invoke({
  tool: "send_email",
  tenantId: "firm_acme",
  inputs: {
    to: "client@example.com",
    subject: "Documents required",
    body: "Hi — please send the BAS workpapers when you get a chance.",
    replyTo: "ops@inbound.tenant.example.com",
    headers: { "X-Acme-Request-Id": "req_abc" },
  },
});
//   result.toolCallId = "tcl_..."        — audit-row identifier
//   result.status     = "SUCCESS"
//   result.result     = handler payload  (e.g. { providerMessageId, status })
```

The API key passed to the client must either be tenant-bound to `tenantId` or be a cross-tenant admin-issued key. Tenant scope mismatches return `BaoBoxError` with `status: 403`. Handler-side failures (e.g. no integration configured for the tenant) come back as `BaoBoxError` with `status: 500`.

The handler resolves any per-tenant integration internally — your code never touches decrypted credentials. For the `send_email` tool, configure a Workspace integration once via `POST /api/v1/admin/integrations` (admin-secret gated), and every subsequent invoke for that tenant routes through it.

## Error handling

Every non-2xx response throws `BaoBoxError`:

```typescript
import { BaoBoxError } from "@baobox/sdk";

try {
  await bb.chat({ skillId: "sk_missing", message: "..." });
} catch (err) {
  if (err instanceof BaoBoxError) {
    console.error(err.status);       // 404
    console.error(err.code);         // "SKILL_NOT_FOUND"
    console.error(err.requestId);    // server-side request id for log correlation
  }
}
```

Network failures surface as `BaoBoxError` with `status: 0` and `code: "NETWORK"`; timeouts as `code: "TIMEOUT"`.

## Configuration

```typescript
new BaoBoxClient({
  endpoint: "...",            // required — BaoBox API base URL
  apiKey: "...",              // optional unless using chat
  adminSecret: "...",         // optional unless using admin/runtime management APIs
  orgId: "firm_a",     // optional, observability tag
  fetch: myFetch,      // optional, injects custom fetch (tests / edge runtimes)
  timeoutMs: 30_000,   // optional, default 30s. Set 0 to disable.
});
```

## Releasing

Publishing is **tag-driven via GitHub Actions** (`.github/workflows/publish.yml`). There is no local `npm login` / `npm publish` flow — auth lives in the `NPM_TOKEN` repo secret, and pushes use `--provenance` for npm provenance attestation. The full release sequence:

```bash
# 1. Bump version in package.json (e.g. 0.4.0 → 0.5.0).
# 2. Update the README + CHANGELOG if anything user-facing moved.
# 3. Commit on main and push.
git add package.json README.md src
git commit -m "feat: 0.4.0 — ..."
git push origin main

# 4. Tag the commit. The publish job is gated on `refs/tags/v*`.
git tag v0.4.0
git push --tags
```

GitHub Actions then runs verify (typecheck + test + build) and, on the tag job only, `npm publish --provenance --access public`. Watch the run at the repo's **Actions** tab; the npm release shows up at https://www.npmjs.com/package/@baobox/sdk a minute or two after the job goes green.

The package's `prepublishOnly` (`clean && build && test`) is the local safety net for anyone who does run `npm publish` by hand — but the day-to-day release path is the tag.

## License

MIT. See [LICENSE](./LICENSE).

## Related

- [BaoBox](https://baobox.ai) — product homepage
