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

Returns `{ response, usage: { inputTokens, outputTokens }, sessionId, meta }` where `meta` carries `requestId`, `latencyMs`, `model`, and an optional `trace` array.

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

Returns `{ response, runId, usage, meta }`. `clientId` and `requestId` land on the BaoBox `call_logs` row (as `client_id` and `external_request_id`) so you can join workflow runs back to your own request log. The skill is responsible for self-routing — there is no `action` discriminator on the request.

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

const skill = await bb.skills.create({
  name: "Document Chaser",
  systemPrompt: "...",
  tools: ["lookup_client_docs"], // SDK convenience: syncs attachments after create
});

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

### Tools (direct invocation) — added in 0.5.0

`bb.tools.invoke()` dispatches a builtin BaoBox tool through `POST /api/v1/tools/invoke` without going through the skill runtime. This is the path workflow apps use after a human approves an action — the LLM produces a draft, the human approves, your code calls the tool directly.

```typescript
const result = await bb.tools.invoke({
  tool: "send_email",
  tenantId: "firm_yongxin",
  inputs: {
    to: "client@example.com",
    subject: "Documents required",
    body: "Hi — please send the BAS workpapers when you get a chance.",
    replyTo: "yongxin_ops@inbound.tenant.nexionops.com",
    headers: { "X-NexionOps-Request-Id": "req_abc" },
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
- [Adoptive Co](https://adoptive.co) — consultancy using BaoBox as a delivery tool
