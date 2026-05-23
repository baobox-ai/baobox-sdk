# Changelog

## 0.8.0

Coordinates with the server-side camelCase wire migration. The server has
started emitting public `/api/v1/workflow` and `/api/v1/chat` responses in
BOTH camelCase (preferred) AND snake_case (deprecated) during the Phase-1
deprecation window — this release lets the SDK keep parsing both shapes so
applications stay forward-compatible when the server eventually drops the
snake variants (Phase 3, separate release).

### Changed

- `chat()` and `workflow()` now SEND camelCase on the wire (`skillId`,
  `sessionId`, `clientId`, `requestId`, `outputSchema`). The server accepts
  either shape but logs a deprecation telemetry row whenever the snake form
  is used — this change opts every SDK user out of that noise immediately.
- Response parsers prefer camelCase fields and fall back to snake_case so
  the SDK works against a Phase-1 server (both shapes), a Phase-3 server
  (camelCase only), and the legacy pre-Phase-1 server (snake only). No
  user-visible API change — the camelCase surface stays exactly as before.
- Error envelope parser reads `error.requestId` first, then falls back to
  `error.request_id` — same forward-compat reasoning.

### Migration

Back-compatible. Existing applications using `bb.chat()` / `bb.workflow()`
need no code change.

### Why

The server-side migration ships a ~2-week deprecation window where both
shapes are accepted on inbound and both are emitted on outbound. Phase 3
(snake-case removed) is gated on telemetry confirming integrator traffic
has fully moved to camelCase.

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
