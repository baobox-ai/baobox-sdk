import { describe, expect, it, vi } from "vitest";
import { BaoboxClient, BaoboxError } from "../src/index.js";

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    return handler(url, init ?? {});
  }) as unknown as typeof globalThis.fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("BaoboxClient constructor", () => {
  it("rejects missing endpoint", () => {
    expect(
      () => new BaoboxClient({ endpoint: "", apiKey: "k" }),
    ).toThrowError(/endpoint required/);
  });

  it("rejects missing apiKey", () => {
    expect(
      () => new BaoboxClient({ endpoint: "https://x", apiKey: "" }),
    ).toThrowError(/apiKey required/);
  });

  it("strips trailing slash from endpoint", async () => {
    const calls: string[] = [];
    const fetch = fakeFetch((url) => {
      calls.push(url);
      return jsonResponse(200, {
        data: { response: "ok", usage: { input_tokens: 1, output_tokens: 2 } },
        metadata: { request_id: "r_1", latency_ms: 5 },
      });
    });
    const sb = new BaoboxClient({
      endpoint: "https://baobox-jv1.example.com/",
      apiKey: "k",
      fetch,
    });
    await sb.chat({ skillId: "sk_1", message: "hi" });
    expect(calls[0]).toBe("https://baobox-jv1.example.com/api/v1/chat");
  });
});

describe("chat", () => {
  it("sends snake_case body, returns camelCase response", async () => {
    const seen: { url?: string; body?: unknown; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.body = JSON.parse(String(init.body));
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, {
        data: {
          response: "chased",
          usage: { input_tokens: 10, output_tokens: 20 },
          session_id: "ses_new",
        },
        metadata: {
          request_id: "r_42",
          latency_ms: 350,
          model: "minimax",
          trace: [
            {
              tool_name: "lookup_client_docs",
              input: { client_id: "cli_01" },
              output: { missing: ["bank_statement"] },
              latency_ms: 42,
            },
          ],
        },
      });
    });

    const sb = new BaoboxClient({
      endpoint: "https://api.example.com",
      apiKey: "sk-123",
      fetch,
    });

    const r = await sb.chat({
      skillId: "sk_chase",
      message: "chase cli_01",
      sessionId: "ses_1",
      metadata: { source: "kanban" },
    });

    expect(seen.url).toBe("https://api.example.com/api/v1/chat");
    expect(seen.auth).toBe("Bearer sk-123");
    expect(seen.body).toEqual({
      skill_id: "sk_chase",
      message: "chase cli_01",
      session_id: "ses_1",
      metadata: { source: "kanban" },
    });
    expect(r.response).toBe("chased");
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(r.sessionId).toBe("ses_new");
    expect(r.meta.requestId).toBe("r_42");
    expect(r.meta.latencyMs).toBe(350);
    expect(r.meta.trace?.[0]).toEqual({
      toolName: "lookup_client_docs",
      input: { client_id: "cli_01" },
      output: { missing: ["bank_statement"] },
      latencyMs: 42,
    });
  });

  it("throws BaoboxError with parsed code/message/request_id on 4xx", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(401, {
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid API key",
          request_id: "r_bad",
        },
      }),
    );
    const sb = new BaoboxClient({
      endpoint: "https://api.example.com",
      apiKey: "wrong",
      fetch,
    });
    try {
      await sb.chat({ skillId: "sk_1", message: "hi" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BaoboxError);
      const e = err as BaoboxError;
      expect(e.status).toBe(401);
      expect(e.code).toBe("UNAUTHORIZED");
      expect(e.message).toBe("Invalid API key");
      expect(e.requestId).toBe("r_bad");
    }
  });
});

describe("sessions", () => {
  it("create maps snake_case", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: {
          id: "ses_1",
          skill_id: "sk_1",
          tenant_id: "t_jv1",
          created_at: "2026-04-18T00:00:00Z",
          updated_at: "2026-04-18T00:00:00Z",
        },
        metadata: { request_id: "r", latency_ms: 3 },
      }),
    );
    const sb = new BaoboxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
      fetch,
    });
    const s = await sb.sessions.create({ skillId: "sk_1" });
    expect(s.id).toBe("ses_1");
    expect(s.skillId).toBe("sk_1");
    expect(s.tenantId).toBe("t_jv1");
  });
});

describe("events.list", () => {
  it("encodes query params", async () => {
    let seenUrl = "";
    const fetch = fakeFetch((url) => {
      seenUrl = url;
      return jsonResponse(200, { data: [], metadata: { request_id: "r", latency_ms: 1 } });
    });
    const sb = new BaoboxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
      fetch,
    });
    await sb.events.list({ sessionId: "ses/1", limit: 50 });
    expect(seenUrl).toBe(
      "https://api.example.com/api/v1/events?session_id=ses%2F1&limit=50",
    );
  });
});

describe("timeout", () => {
  it("aborts after timeoutMs and throws TIMEOUT error", async () => {
    const fetch: typeof globalThis.fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new DOMException("aborted", "AbortError");
          reject(err);
        });
      });
    const sb = new BaoboxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
      fetch,
      timeoutMs: 10,
    });
    try {
      await sb.chat({ skillId: "sk_1", message: "hi" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BaoboxError);
      expect((err as BaoboxError).code).toBe("TIMEOUT");
    }
  });
});
