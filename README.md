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

## License

MIT. See [LICENSE](./LICENSE).

## Related

- [BaoBox](https://baobox.ai) — product homepage
- [Adoptive Co](https://adoptive.co) — consultancy using BaoBox as a delivery tool
