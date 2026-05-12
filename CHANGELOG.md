# Changelog

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
