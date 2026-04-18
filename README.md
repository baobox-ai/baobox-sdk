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
  apiKey: process.env.BAOBOX_API_KEY!,
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

### Sessions

```typescript
const session = await bb.sessions.create({ skillId: "sk_chase" });
const history = await bb.sessions.messages(session.id);
```

### Admin (requires admin token)

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

### Events (trace)

```typescript
const events = await bb.events.list({ sessionId: "ses_1", limit: 50 });
```

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
  endpoint: "...",     // required — BaoBox API base URL
  apiKey: "...",       // required
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
