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

### Sessions, Skills, Tools, Eval, Admin

BaoBox now splits auth:

- `apiKey` is only for `chat`
- `adminSecret` is for `sessions`, `skills`, `tools`, `eval`, and `admin`

```typescript
const session = await bb.sessions.create({ skillId: "sk_chase" });
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
