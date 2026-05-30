import { describe, it, expect, vi } from "vitest";
import { BaoBoxClient } from "../src/index.js";
import type { SseEvent } from "../src/types.js";

// Build a Response whose body is a ReadableStream emitting the given SSE string.
function makeSseResponse(sseText: string, status = 200): Response {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(sseText);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

// Build a Response from multiple chunks (simulates partial delivery).
function makeChunkedSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function collectEvents(
  client: BaoBoxClient,
  req: Parameters<BaoBoxClient["chatStream"]>[0],
): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const ev of client.chatStream(req)) {
    events.push(ev);
  }
  return events;
}

function makeClient(fetchMock: typeof globalThis.fetch) {
  return new BaoBoxClient({
    endpoint: "https://baobox.example.com",
    apiKey: "sk_a",
    fetch: fetchMock,
  });
}

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("chatStream — happy path", () => {
  it("yields preflight_start → preflight_pass → assistant_message → done", async () => {
    const sse = [
      "event: preflight_start\ndata: {}\n\n",
      "event: preflight_pass\ndata: {\"latency_ms\":12}\n\n",
      "event: assistant_message\ndata: {\"content\":\"hello\",\"blocks\":[{\"type\":\"text\",\"text\":\"hello\"}]}\n\n",
      "event: done\ndata: {\"usage\":{\"input_tokens\":10,\"output_tokens\":5},\"session_id\":\"sess_1\"}\n\n",
    ].join("");

    const fetchMock = vi.fn().mockResolvedValue(makeSseResponse(sse));
    const client = makeClient(fetchMock);

    const events = await collectEvents(client, { skillId: "sk_a", message: "hi" });

    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({ event: "preflight_start", data: {} });
    expect(events[1]).toEqual({ event: "preflight_pass", data: { latency_ms: 12 } });
    expect(events[2]).toEqual({
      event: "assistant_message",
      data: { content: "hello", blocks: [{ type: "text", text: "hello" }] },
    });
    expect(events[3]).toEqual({
      event: "done",
      data: { usage: { input_tokens: 10, output_tokens: 5 }, session_id: "sess_1" },
    });

    // Verify the request shape.
    const call0 = fetchMock.mock.calls[0] as [string, RequestInit];
    const calledUrl = call0[0];
    const calledInit = call0[1];
    expect(calledUrl).toBe("https://baobox.example.com/api/v1/chat/stream");
    expect((calledInit.headers as Record<string, string>)["accept"]).toBe("text/event-stream");
    expect((calledInit.headers as Record<string, string>)["authorization"]).toBe("Bearer sk_a");
    expect(JSON.parse(calledInit.body as string)).toEqual({ skillId: "sk_a", message: "hi" });
  });
});

// ─── Tool call ────────────────────────────────────────────────────────────────

describe("chatStream — tool call round-trip", () => {
  it("yields tool_call → tool_result within a stream", async () => {
    const sse = [
      "event: preflight_start\ndata: {}\n\n",
      "event: tool_call\ndata: {\"tool_name\":\"send_email\",\"tool_call_id\":\"tc_1\"}\n\n",
      "event: tool_result\ndata: {\"tool_call_id\":\"tc_1\",\"success\":true,\"latency_ms\":300}\n\n",
      "event: assistant_message\ndata: {\"content\":\"done\",\"blocks\":[]}\n\n",
      "event: done\ndata: {}\n\n",
    ].join("");

    const client = makeClient(vi.fn().mockResolvedValue(makeSseResponse(sse)));
    const events = await collectEvents(client, { message: "send it" });

    expect(events[1]).toEqual({
      event: "tool_call",
      data: { tool_name: "send_email", tool_call_id: "tc_1" },
    });
    expect(events[2]).toEqual({
      event: "tool_result",
      data: { tool_call_id: "tc_1", success: true, latency_ms: 300 },
    });
  });
});

// ─── Postflight retry ─────────────────────────────────────────────────────────

describe("chatStream — postflight retry sequence", () => {
  it("yields postflight_block → postflight_retry_triggered → postflight_pass → assistant_message → done", async () => {
    const sse = [
      "event: preflight_pass\ndata: {\"latency_ms\":5}\n\n",
      "event: postflight_block\ndata: {\"reason\":\"unsafe\",\"retry_advisable\":true}\n\n",
      "event: postflight_retry_triggered\ndata: {\"retry_hint\":\"tone-down\"}\n\n",
      "event: postflight_pass\ndata: {\"attempt\":2}\n\n",
      "event: assistant_message\ndata: {\"content\":\"sure\",\"blocks\":[]}\n\n",
      "event: done\ndata: {}\n\n",
    ].join("");

    const client = makeClient(vi.fn().mockResolvedValue(makeSseResponse(sse)));
    const events = await collectEvents(client, { message: "risky" });

    expect(events[1]).toEqual({
      event: "postflight_block",
      data: { reason: "unsafe", retry_advisable: true },
    });
    expect(events[2]).toEqual({
      event: "postflight_retry_triggered",
      data: { retry_hint: "tone-down" },
    });
    expect(events[3]).toEqual({ event: "postflight_pass", data: { attempt: 2 } });
  });
});

// ─── Refusal ──────────────────────────────────────────────────────────────────

describe("chatStream — refusal", () => {
  it("yields refusal then done", async () => {
    const sse = [
      "event: preflight_start\ndata: {}\n\n",
      "event: refusal\ndata: {\"reason\":\"policy\",\"surface\":\"preflight\"}\n\n",
      "event: done\ndata: {}\n\n",
    ].join("");

    const client = makeClient(vi.fn().mockResolvedValue(makeSseResponse(sse)));
    const events = await collectEvents(client, { message: "bad" });

    expect(events[1]).toEqual({
      event: "refusal",
      data: { reason: "policy", surface: "preflight" },
    });
    expect(events[2]).toEqual({ event: "done", data: {} });
  });
});

// ─── Multi-frame chunk ────────────────────────────────────────────────────────

describe("chatStream — multi-frame chunks", () => {
  it("splits two frames arriving in a single read correctly", async () => {
    // Two complete frames in one chunk.
    const chunk =
      "event: preflight_start\ndata: {}\n\n" +
      "event: preflight_pass\ndata: {\"latency_ms\":7}\n\n";

    const client = makeClient(
      vi.fn().mockResolvedValue(makeChunkedSseResponse([chunk])),
    );
    const events = await collectEvents(client, { message: "hi" });

    expect(events).toHaveLength(2);
    expect(events[0]!.event).toBe("preflight_start");
    expect(events[1]!.event).toBe("preflight_pass");
  });
});

// ─── Partial chunks ───────────────────────────────────────────────────────────

describe("chatStream — partial chunks (buffer stitching)", () => {
  it("reassembles a frame split across two reads", async () => {
    // First chunk ends mid-frame.
    const part1 = "event: assistant_message\ndata: {\"content\":\"hi\",";
    const part2 = "\"blocks\":[]}\n\n";

    const client = makeClient(
      vi.fn().mockResolvedValue(makeChunkedSseResponse([part1, part2])),
    );
    const events = await collectEvents(client, { message: "hey" });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: "assistant_message",
      data: { content: "hi", blocks: [] },
    });
  });
});

// ─── Heartbeat ────────────────────────────────────────────────────────────────

describe("chatStream — heartbeat", () => {
  it("emits heartbeat events to the consumer", async () => {
    const sse = [
      "event: preflight_start\ndata: {}\n\n",
      "event: heartbeat\ndata: {}\n\n",
      "event: assistant_message\ndata: {\"content\":\"pong\",\"blocks\":[]}\n\n",
      "event: done\ndata: {}\n\n",
    ].join("");

    const client = makeClient(vi.fn().mockResolvedValue(makeSseResponse(sse)));
    const events = await collectEvents(client, { message: "ping" });

    expect(events[1]).toEqual({ event: "heartbeat", data: {} });
    expect(events).toHaveLength(4);
  });
});

// ─── Non-200 error ────────────────────────────────────────────────────────────

describe("chatStream — HTTP error", () => {
  it("throws BaoBoxError on non-200 response", async () => {
    const errBody = JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "bad key" } });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(errBody, { status: 401, headers: { "content-type": "application/json" } }),
    );
    const client = makeClient(fetchMock);

    const iter = client.chatStream({ message: "hi" });
    await expect(iter[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
  });
});

// ─── sessionId + metadata threaded through ────────────────────────────────────

describe("chatStream — request body fields", () => {
  it("sends sessionId and metadata when provided", async () => {
    const sse = "event: done\ndata: {}\n\n";
    const fetchMock = vi.fn().mockResolvedValue(makeSseResponse(sse));
    const client = makeClient(fetchMock);

    await collectEvents(client, {
      skillId: "sk_b",
      message: "hello",
      sessionId: "sess_abc",
      metadata: { userId: "u1" },
    });

    const body = JSON.parse(((fetchMock.mock.calls[0] as [string, RequestInit])[1]).body as string);
    expect(body).toEqual({
      skillId: "sk_b",
      message: "hello",
      sessionId: "sess_abc",
      metadata: { userId: "u1" },
    });
  });
});
