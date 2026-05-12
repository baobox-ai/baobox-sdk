// Attachment smoke for SDK 0.6.0.
//
// Runs three workflow() calls — one per source kind — against a local
// BaoBox dev server and prints the run id, latency, and the metadata
// of the resulting `attachment_received` event.
//
// Usage:
//   BAOBOX_ENDPOINT=http://localhost:8787 \
//   BAOBOX_API_KEY=sk_… \
//   BAOBOX_SKILL_ID=sk_email_chase \
//   npx tsx examples/attachment-smoke.ts
//
// The skill must exist on the local server and be wired to the tenant
// that owns the api key. The local server should also have B-1, B-3,
// and B-4 deployed (the inline + url paths need L2 extract_text).

import { BaoBoxClient } from "../src/index.js";

const endpoint = process.env.BAOBOX_ENDPOINT ?? "http://localhost:8787";
const apiKey = process.env.BAOBOX_API_KEY;
const skill = process.env.BAOBOX_SKILL_ID ?? "sk_email_chase";

if (!apiKey) {
  console.error("BAOBOX_API_KEY required");
  process.exit(1);
}

const bb = new BaoBoxClient({ endpoint, apiKey });

async function main(): Promise<void> {
  const requestIdBase = `smoke_${Date.now()}`;

  // ── 1) URL-sourced attachment ─────────────────────────────────────
  // Public CC-0 PDF works as a smoke source; in real use this would be
  // a signed URL pointing at your own R2 bucket.
  console.log("\n[url] sending workflow with a url-sourced attachment");
  const urlResult = await bb.workflow({
    skill,
    clientId: "smoke",
    requestId: `${requestIdBase}_url`,
    input: "Summarise the attached PDF in one sentence.",
    attachments: [
      bb.attachments.fromUrl({
        url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        filename: "dummy.pdf",
        mimeType: "application/pdf",
      }),
    ],
  });
  console.log(`  runId=${urlResult.runId} latency=${urlResult.meta.latencyMs}ms`);

  // ── 2) Inline base64 attachment ───────────────────────────────────
  // Small text payload — exercises the < 5 MB helper path.
  console.log("\n[inline] sending workflow with an inline attachment");
  const inlineBytes = new TextEncoder().encode(
    "Subject: missing docs\n\nPlease send the bank statement.",
  );
  const inlineResult = await bb.workflow({
    skill,
    clientId: "smoke",
    requestId: `${requestIdBase}_inline`,
    input: "Reply to this inbound email politely.",
    attachments: [
      bb.attachments.fromInline({
        bytes: inlineBytes,
        filename: "inbound.eml",
        mimeType: "message/rfc822",
      }),
    ],
  });
  console.log(`  runId=${inlineResult.runId} latency=${inlineResult.meta.latencyMs}ms`);

  // ── 3) baobox_ref re-use ──────────────────────────────────────────
  // Re-uses the att_id from step 2 — proves the dispatcher resolves a
  // prior upload without re-fetching bytes.
  const reusedAttId = await findReusableAttId(inlineResult.runId);
  if (!reusedAttId) {
    console.log("\n[baobox_ref] skipped — no att_id surfaced on the timeline yet");
    return;
  }
  console.log(`\n[baobox_ref] re-using att_id=${reusedAttId}`);
  const refResult = await bb.workflow({
    skill,
    clientId: "smoke",
    requestId: `${requestIdBase}_ref`,
    input: "Did the inbound email actually ask for a bank statement?",
    attachments: [bb.attachments.fromRef({ attId: reusedAttId })],
  });
  console.log(`  runId=${refResult.runId} latency=${refResult.meta.latencyMs}ms`);
}

// Pulls the first att_id off the run's timeline so we can demo the
// baobox_ref path in step 3.
async function findReusableAttId(runId: string): Promise<string | null> {
  const timeline = await bb.runs.get(runId);
  for (const event of timeline.events) {
    if (event.eventType === "user_message") continue;
    const attId = (event.metadata as { att_id?: string }).att_id;
    if (typeof attId === "string") return attId;
  }
  return null;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
