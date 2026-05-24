import { describe, expect, it, vi } from "vitest";
import {
  attachmentFromInline,
  attachmentFromRef,
  attachmentFromUrl,
  attachmentWithStrategy,
  BaoBoxClient,
  BaoBoxError,
  MAX_INLINE_BYTES,
} from "../src/index.js";
import type { AttachmentInput } from "../src/index.js";

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

describe("BaoBoxClient constructor", () => {
  it("rejects missing endpoint", () => {
    expect(
      () => new BaoBoxClient({ endpoint: "", apiKey: "k" }),
    ).toThrowError(/endpoint required/);
  });

  it("rejects missing credentials", () => {
    expect(
      () => new BaoBoxClient({ endpoint: "https://x" }),
    ).toThrowError(/apiKey or adminSecret required/);
  });

  it("strips trailing slash from endpoint", async () => {
    const calls: string[] = [];
    const fetch = fakeFetch((url) => {
      calls.push(url);
      return jsonResponse(200, {
        data: { response: "ok", usage: { inputTokens: 1, outputTokens: 2 } },
        metadata: { requestId: "r_1", latencyMs: 5 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://baobox-jv1.example.com/",
      apiKey: "k",
      fetch,
    });
    await bb.chat({ message: "hi" });
    expect(calls[0]).toBe("https://baobox-jv1.example.com/api/v1/chat");
  });
});

describe("health", () => {
  it("calls health without authorization header", async () => {
    let seenAuth: string | null = "missing";
    const fetch = fakeFetch((_url, init) => {
      seenAuth = (init.headers as Record<string, string> | undefined)?.authorization ?? null;
      return jsonResponse(200, {
        data: { status: "ok", version: "0.1.0" },
        metadata: { requestId: "r_health", latencyMs: 1 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const res = await bb.health.get();
    expect(seenAuth).toBeNull();
    expect(res.status).toBe("ok");
    expect(res.version).toBe("0.1.0");
    expect(res.meta.requestId).toBe("r_health");
  });
});

describe("chat", () => {
  it("sends camelCase body, parses legacy snake_case response", async () => {
    const seen: { url?: string; body?: unknown; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.body = JSON.parse(String(init.body));
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, {
        data: {
          response: "chased",
          usage: { inputTokens: 10, outputTokens: 20 },
          sessionId: "ses_new",
        },
        metadata: {
          requestId: "r_42",
          latencyMs: 350,
          model: "minimax",
          trace: [
            {
              toolName: "lookup_client_docs",
              input: { clientId: "cli_01" },
              output: { missing: ["bank_statement"] },
              latencyMs: 42,
            },
          ],
        },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "sk-123",
      fetch,
    });

    const r = await bb.chat({
      skillId: "sk_chase",
      message: "chase cli_01",
      sessionId: "ses_1",
      metadata: { source: "kanban" },
    });

    expect(seen.url).toBe("https://api.example.com/api/v1/chat");
    expect(seen.auth).toBe("Bearer sk-123");
    expect(seen.body).toEqual({
      skillId: "sk_chase",
      message: "chase cli_01",
      sessionId: "ses_1",
      metadata: { source: "kanban" },
    });
    expect(r.response).toBe("chased");
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(r.sessionId).toBe("ses_new");
    expect(r.meta.requestId).toBe("r_42");
    expect(r.meta.latencyMs).toBe(350);
    expect(r.meta.trace?.[0]).toEqual({
      toolName: "lookup_client_docs",
      input: { clientId: "cli_01" },
      output: { missing: ["bank_statement"] },
      latencyMs: 42,
    });
  });

  it("throws early when apiKey is missing", async () => {
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch: fakeFetch(() => {
        throw new Error("should not reach fetch");
      }),
    });

    await expect(bb.chat({ message: "hi" })).rejects.toThrow(/apiKey required/);
  });

  it("throws BaoBoxError with parsed code/message/request_id on 4xx", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(401, {
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid API key",
          requestId: "r_bad",
        },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "wrong",
      fetch,
    });
    try {
      await bb.chat({ message: "hi" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BaoBoxError);
      const e = err as BaoBoxError;
      expect(e.status).toBe(401);
      expect(e.code).toBe("UNAUTHORIZED");
      expect(e.message).toBe("Invalid API key");
      expect(e.requestId).toBe("r_bad");
    }
  });
});

describe("admin auth surfaces", () => {
  it("uses adminSecret for skills.list", async () => {
    const seen: { url?: string; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, {
        data: [
          {
            id: "sk_1",
            name: "Chaser",
            description: "desc",
            systemPrompt: "prompt",
            model: "MiniMax-M2.7",
            temperature: 0.2,
            maxTokens: 4096,
            sourceUrl: null,
            tenantId: "t_1",
            createdAt: "2026-04-23T00:00:00Z",
            updatedAt: "2026-04-23T00:00:00Z",
          },
        ],
        metadata: { requestId: "r_skill", latencyMs: 5 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm-secret",
      fetch,
    });

    const skills = await bb.skills.list();
    expect(seen.url).toBe("https://api.example.com/api/v1/skills");
    expect(seen.auth).toBe("Bearer adm-secret");
    expect(skills[0]?.systemPrompt).toBe("prompt");
    expect(skills[0]?.sourceUrl).toBeNull();
  });

  it("events.list hits session timeline and unwraps the nested response", async () => {
    let seenUrl = "";
    const fetch = fakeFetch((url) => {
      seenUrl = url;
      return jsonResponse(200, {
        data: {
          sessionId: "ses/1",
          events: [
            {
              eventId: "evt_1",
              sessionId: "ses/1",
              requestId: "r_1",
              runId: null,
              eventType: "tool_result",
              content: null,
              metadata: "{\"ok\":true}",
              tokenCount: 0,
              latencyMs: 9,
              parentEventId: null,
              createdAt: "2026-04-23T00:00:00Z",
            },
          ],
        },
        metadata: { requestId: "r_tl", latencyMs: 1 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const events = await bb.events.list({ sessionId: "ses/1" });
    expect(seenUrl).toBe("https://api.example.com/api/v1/sessions/ses%2F1/timeline");
    expect(events).toEqual([
      {
        id: "evt_1",
        sessionId: "ses/1",
        requestId: "r_1",
        runId: null,
        eventType: "tool_result",
        content: null,
        metadata: { ok: true },
        tokenCount: 0,
        latencyMs: 9,
        parentEventId: null,
        createdAt: "2026-04-23T00:00:00Z",
      },
    ]);
  });

  it("keeps old admin.skills.upsert working and syncs tool attachments", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fetch = fakeFetch((url, init) => {
      const method = init.method ?? "GET";
      calls.push({ method, url });

      if (method === "PUT" && url === "https://api.example.com/api/v1/skills/sk_1") {
        return jsonResponse(200, {
          data: {
            skillId: "sk_1",
            name: "Chaser",
            description: "desc",
            systemPrompt: "prompt",
            model: "MiniMax-M2.7",
            temperature: 0.2,
            maxTokens: 4096,
            sourceUrl: null,
            tenantId: null,
            createdAt: "2026-04-23T00:00:00Z",
            updatedAt: "2026-04-23T00:00:00Z",
          },
          metadata: { requestId: "r_skill", latencyMs: 1 },
        });
      }

      if (method === "GET" && url === "https://api.example.com/api/v1/tools/skills/sk_1/tools") {
        return jsonResponse(200, {
          data: [
            {
              toolId: "tool_old",
              name: "Old Tool",
              description: "desc",
              inputSchema: "{}",
              handlerType: "builtin",
              handlerConfig: "{}",
              createdAt: "2026-04-23T00:00:00Z",
            },
          ],
          metadata: { requestId: "r_tools", latencyMs: 1 },
        });
      }

      if (
        method === "DELETE" &&
        url === "https://api.example.com/api/v1/tools/skills/sk_1/tools/tool_old"
      ) {
        return jsonResponse(200, {
          data: { detached: true },
          metadata: { requestId: "r_detach", latencyMs: 0 },
        });
      }

      if (
        method === "POST" &&
        url === "https://api.example.com/api/v1/tools/skills/sk_1/tools/tool_new"
      ) {
        return jsonResponse(200, {
          data: { attached: true },
          metadata: { requestId: "r_attach", latencyMs: 0 },
        });
      }

      throw new Error(`Unexpected call: ${method} ${url}`);
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const skill = await bb.admin.skills.upsert({
      id: "sk_1",
      name: "Chaser",
      systemPrompt: "prompt",
      tools: ["tool_new"],
    });

    expect(skill.id).toBe("sk_1");
    expect(calls).toEqual([
      { method: "PUT", url: "https://api.example.com/api/v1/skills/sk_1" },
      { method: "GET", url: "https://api.example.com/api/v1/tools/skills/sk_1/tools" },
      {
        method: "DELETE",
        url: "https://api.example.com/api/v1/tools/skills/sk_1/tools/tool_old",
      },
      {
        method: "POST",
        url: "https://api.example.com/api/v1/tools/skills/sk_1/tools/tool_new",
      },
    ]);
  });

  it("keeps old admin.tools.upsert working against /api/v1/tools", async () => {
    let seenUrl = "";
    let seenMethod = "";
    const fetch = fakeFetch((url, init) => {
      seenUrl = url;
      seenMethod = init.method ?? "GET";
      return jsonResponse(201, {
        data: {
          id: "tool_1",
          name: "lookup",
          description: "desc",
          inputSchema: "{\"type\":\"object\"}",
          handlerType: "http",
          handlerConfig: "{\"url\":\"https://example.com\"}",
          createdAt: "2026-04-23T00:00:00Z",
        },
        metadata: { requestId: "r_tool", latencyMs: 1 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const tool = await bb.admin.tools.upsert({
      name: "lookup",
      description: "desc",
      inputSchema: { type: "object" },
      handlerType: "http",
      handlerConfig: { url: "https://example.com" },
    });

    expect(seenMethod).toBe("POST");
    expect(seenUrl).toBe("https://api.example.com/api/v1/tools");
    expect(tool.handlerType).toBe("http");
  });
});

describe("admin and eval helpers", () => {
  it("creates API keys and maps tenant_id", async () => {
    let seenAuth = "";
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenAuth = (init.headers as Record<string, string>).authorization ?? "";
      seenBody = init.body ? JSON.parse(String(init.body)) : {};
      return jsonResponse(201, {
        data: {
          apiKeyId: "key_1",
          key: "skb_raw",
          name: "demo",
          tenantId: "t_default",
        },
        metadata: { requestId: "r_key", latencyMs: 0 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const key = await bb.admin.keys.create({ name: "demo" });
    expect(seenAuth).toBe("Bearer adm");
    // When tenantId is omitted, compactObject must drop the field entirely
    // so the server falls back to t_default.
    expect(seenBody).not.toHaveProperty("tenant_id");
    expect(seenBody).toEqual({ name: "demo" });
    expect(key).toEqual({
      id: "key_1",
      key: "skb_raw",
      name: "demo",
      tenantId: "t_default",
    });
  });

  it("forwards tenantId in admin.keys.create body when provided", async () => {
    let seenBody: unknown = null;
    const fetch = fakeFetch((_url, init) => {
      seenBody = init.body ? JSON.parse(String(init.body)) : null;
      return jsonResponse(201, {
        data: {
          apiKeyId: "key_1",
          key: "skb_raw",
          name: "demo",
          tenantId: "demo_tenant",
        },
        metadata: { requestId: "r_1", latencyMs: 0 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });
    const key = await bb.admin.keys.create({ name: "demo", tenantId: "demo_tenant" });
    expect(seenBody).toEqual({ name: "demo", tenantId: "demo_tenant" });
    expect(key.tenantId).toBe("demo_tenant");
  });

  it("encodes eval.compare query params", async () => {
    let seenUrl = "";
    const fetch = fakeFetch((url) => {
      seenUrl = url;
      return jsonResponse(200, {
        data: {
          skillId: "sk/1",
          versionA: { label: "A", dimensions: [{ score: 3 }] },
          versionB: { label: "B", dimensions: [{ score: 4 }] },
        },
        metadata: { requestId: "r_cmp", latencyMs: 0 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const result = await bb.eval.compare({ skillId: "sk/1", a: "v 1", b: "v/2" });
    expect(seenUrl).toBe(
      "https://api.example.com/api/v1/eval/compare?skillId=sk%2F1&a=v+1&b=v%2F2",
    );
    expect(result.skillId).toBe("sk/1");
    expect(result.versionA.label).toBe("A");
    expect(result.versionB.label).toBe("B");
  });
});

describe("workflow", () => {
  it("sends camelCase body, parses legacy snake_case response with runId", async () => {
    const seen: { url?: string; body?: unknown; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.body = JSON.parse(String(init.body));
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, {
        data: {
          response: "drafted",
          runId: "wflow_abc123",
          usage: { inputTokens: 50, outputTokens: 25 },
        },
        metadata: { requestId: "r_wf", latencyMs: 320, model: "MiniMax-M2.7" },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "skb-wf",
      fetch,
    });

    const r = await bb.workflow({
      skill: "sk_email_chase",
      clientId: "client_abc",
      requestId: "nexionops_req_42",
      input: "chase client for missing bank statements",
      history: [
        { role: "user", content: "draft an email" },
        { role: "assistant", content: "Sure, here's the draft..." },
      ],
    });

    expect(seen.url).toBe("https://api.example.com/api/v1/workflow");
    expect(seen.auth).toBe("Bearer skb-wf");
    expect(seen.body).toEqual({
      skill: "sk_email_chase",
      clientId: "client_abc",
      requestId: "nexionops_req_42",
      input: "chase client for missing bank statements",
      history: [
        { role: "user", content: "draft an email" },
        { role: "assistant", content: "Sure, here's the draft..." },
      ],
    });
    expect(r.response).toBe("drafted");
    expect(r.runId).toBe("wflow_abc123");
    expect(r.usage).toEqual({ inputTokens: 50, outputTokens: 25 });
    expect(r.meta.requestId).toBe("r_wf");
  });

  it("forwards output_schema and maps structured output", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(String(init.body));
      return jsonResponse(200, {
        data: {
          response: '```json\\n{"status":"ok","items":["bank_statement"]}\\n```',
          output: { status: "ok", items: ["bank_statement"] },
          runId: "wflow_struct",
          usage: { inputTokens: 9, outputTokens: 4 },
        },
        metadata: { requestId: "r_wf_struct", latencyMs: 25 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
      fetch,
    });

    const result = await bb.workflow<{ status: string; items: string[] }>({
      skill: "sk_x",
      clientId: "c",
      requestId: "rq",
      input: "hi",
      outputSchema: {
        type: "object",
        required: ["status", "items"],
        properties: {
          status: { type: "string" },
          items: { type: "array", items: { type: "string" } },
        },
      },
    });

    expect(seenBody).toEqual({
      skill: "sk_x",
      clientId: "c",
      requestId: "rq",
      input: "hi",
      outputSchema: {
        type: "object",
        required: ["status", "items"],
        properties: {
          status: { type: "string" },
          items: { type: "array", items: { type: "string" } },
        },
      },
    });
    expect(result.output).toEqual({ status: "ok", items: ["bank_statement"] });
  });

  it("workflowStructured requires structured output in the response", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: {
          response: "{}",
          runId: "wflow_struct_missing",
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        metadata: { requestId: "r_missing", latencyMs: 10 },
      }));
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
      fetch,
    });

    await expect(
      bb.workflowStructured<{ status: string }>({
        skill: "sk_x",
        clientId: "c",
        requestId: "rq",
        input: "hi",
        outputSchema: {
          type: "object",
          required: ["status"],
          properties: { status: { type: "string" } },
        },
      }),
    ).rejects.toBeInstanceOf(BaoBoxError);
  });

  it("omits history when not provided", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(String(init.body));
      return jsonResponse(200, {
        data: {
          response: "ok",
          runId: "wflow_def",
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        metadata: { requestId: "r_wf2", latencyMs: 10 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
      fetch,
    });
    await bb.workflow({
      skill: "sk_x",
      clientId: "c",
      requestId: "rq",
      input: "hi",
    });
    expect("history" in seenBody).toBe(false);
  });

  it("propagates 404 from BaoBox as BaoBoxError", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(404, {
        error: { code: "NOT_FOUND", message: "Skill 'sk_missing' not found", requestId: "r_x" },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
      fetch,
    });
    await expect(
      bb.workflow({
        skill: "sk_missing",
        clientId: "c",
        requestId: "rq",
        input: "hi",
      }),
    ).rejects.toBeInstanceOf(BaoBoxError);
  });
});

// 0.8.0 — server-side migration ships dual-emit (camelCase + snake_case)
// during the Phase-1 deprecation window. The SDK must keep parsing every
// shape it could meet in the wild: legacy snake-only (pre-Phase-1 server),
// Phase-1 dual-emit, and Phase-3 camel-only.
describe("0.8.0 wire compat — chat()", () => {
  it("parses Phase-3 camelCase-only response", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: {
          response: "hi",
          usage: { inputTokens: 11, outputTokens: 22 },
          sessionId: "ses_p3",
        },
        metadata: {
          requestId: "r_p3",
          latencyMs: 99,
          trace: [
            {
              toolName: "lookup",
              input: { q: "x" },
              output: { ok: true },
              latencyMs: 7,
            },
          ],
        },
      }),
    );
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", apiKey: "k", fetch });
    const r = await bb.chat({ message: "hi" });
    expect(r.usage).toEqual({ inputTokens: 11, outputTokens: 22 });
    expect(r.sessionId).toBe("ses_p3");
    expect(r.meta.requestId).toBe("r_p3");
    expect(r.meta.latencyMs).toBe(99);
    expect(r.meta.trace?.[0]?.toolName).toBe("lookup");
    expect(r.meta.trace?.[0]?.latencyMs).toBe(7);
  });

  it("parses Phase-1 dual-emit response (both shapes present)", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: {
          response: "hi",
          usage: {
            inputTokens: 1,
            input_tokens: 1,
            outputTokens: 2,
            output_tokens: 2,
          },
          sessionId: "ses_dual",
          session_id: "ses_dual",
        },
        metadata: {
          requestId: "r_dual",
          request_id: "r_dual",
          latencyMs: 5,
          latency_ms: 5,
        },
      }),
    );
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", apiKey: "k", fetch });
    const r = await bb.chat({ message: "hi" });
    expect(r.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
    expect(r.sessionId).toBe("ses_dual");
    expect(r.meta.requestId).toBe("r_dual");
  });
});

describe("0.8.0 wire compat — workflow()", () => {
  it("parses Phase-3 camelCase-only response", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: {
          response: "done",
          runId: "wflow_p3",
          usage: { inputTokens: 7, outputTokens: 3 },
        },
        metadata: { requestId: "r_wf_p3", latencyMs: 10 },
      }),
    );
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", apiKey: "k", fetch });
    const r = await bb.workflow({ skill: "s", clientId: "c", requestId: "rq", input: "in" });
    expect(r.runId).toBe("wflow_p3");
    expect(r.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(r.meta.requestId).toBe("r_wf_p3");
  });
});

describe("0.8.0 wire compat — error envelope", () => {
  it("reads error.requestId (Phase-3 camelCase-only)", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "bad", requestId: "r_err_camel" },
      }),
    );
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", apiKey: "k", fetch });
    try {
      await bb.chat({ message: "hi" });
      throw new Error("expected BaoBoxError");
    } catch (err) {
      const e = err as BaoBoxError;
      expect(e.requestId).toBe("r_err_camel");
    }
  });

  it("reads error.request_id (legacy snake-only) for back-compat", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "bad", requestId: "r_err_snake" },
      }),
    );
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", apiKey: "k", fetch });
    try {
      await bb.chat({ message: "hi" });
      throw new Error("expected BaoBoxError");
    } catch (err) {
      const e = err as BaoBoxError;
      expect(e.requestId).toBe("r_err_snake");
    }
  });
});

describe("runs", () => {
  it("get(runId) returns timeline with mapped events", async () => {
    const seen: { url?: string; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, {
        data: {
          runId: "wflow_abc123",
          events: [
            {
              id: "evt_1",
              sessionId: null,
              requestId: "req_1",
              runId: "wflow_abc123",
              eventType: "llm_call_start",
              content: null,
              metadata: { round: 0 },
              tokenCount: 0,
              latencyMs: 0,
              parentEventId: null,
              createdAt: "2026-04-25T10:00:00Z",
            },
            {
              id: "evt_2",
              sessionId: null,
              requestId: "req_1",
              runId: "wflow_abc123",
              eventType: "human_approved",
              content: "Looks good",
              metadata: { staff_user: "alice" },
              tokenCount: 0,
              latencyMs: 0,
              parentEventId: null,
              createdAt: "2026-04-25T10:00:30Z",
            },
          ],
        },
        metadata: { requestId: "r_runs_get", latencyMs: 5 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const timeline = await bb.runs.get("wflow_abc123");
    expect(seen.url).toBe("https://api.example.com/api/v1/admin/runs/wflow_abc123/timeline");
    expect(seen.auth).toBe("Bearer adm");
    expect(timeline.runId).toBe("wflow_abc123");
    expect(timeline.events).toHaveLength(2);
    const [first, second] = timeline.events;
    expect(first?.eventType).toBe("llm_call_start");
    expect(first?.runId).toBe("wflow_abc123");
    expect(second?.eventType).toBe("human_approved");
    expect(second?.metadata).toEqual({ staff_user: "alice" });
  });

  it("list() forwards clientId/since/limit as query params and maps response", async () => {
    let seenUrl = "";
    const fetch = fakeFetch((url) => {
      seenUrl = url;
      return jsonResponse(200, {
        data: [
          {
            callLogId: "log_1",
            requestId: "req_1",
            runId: "wflow_1",
            skillId: "sk_chase",
            clientId: "client_X",
            externalRequestId: "ext_1",
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            latencyMs: 320,
            toolCallsCount: 1,
            status: "success",
            errorCode: null,
            createdAt: "2026-04-25T10:00:00Z",
          },
        ],
        metadata: { requestId: "r_runs_list", latencyMs: 3 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const runs = await bb.runs.list({
      clientId: "client_X",
      since: "2026-04-01T00:00:00Z",
      limit: 25,
    });

    expect(seenUrl).toContain("/api/v1/admin/runs?");
    expect(seenUrl).toContain("clientId=client_X");
    expect(seenUrl).toContain("since=2026-04-01T00%3A00%3A00Z");
    expect(seenUrl).toContain("limit=25");
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run?.runId).toBe("wflow_1");
    expect(run?.clientId).toBe("client_X");
    expect(run?.externalRequestId).toBe("ext_1");
    expect(run?.totalTokens).toBe(150);
    expect(run?.status).toBe("success");
  });

  it("list() with no args sends no query string", async () => {
    let seenUrl = "";
    const fetch = fakeFetch((url) => {
      seenUrl = url;
      return jsonResponse(200, {
        data: [],
        metadata: { requestId: "r_runs_empty", latencyMs: 1 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    await bb.runs.list();
    expect(seenUrl).toBe("https://api.example.com/api/v1/admin/runs");
  });

  it("appendEvent posts snake_case body and returns mapped result", async () => {
    const seen: { url?: string; body?: unknown; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.body = JSON.parse(String(init.body));
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(201, {
        data: {
          eventId: "evt_appended_1",
          runId: "wflow_abc123",
          eventType: "human_approved",
        },
        metadata: { requestId: "r_append", latencyMs: 2 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const result = await bb.runs.appendEvent("wflow_abc123", {
      eventType: "human_approved",
      content: "Looks good — sending.",
      metadata: { staff_user: "alice", reviewed_at: "2026-04-25T10:00:30Z" },
    });

    expect(seen.url).toBe("https://api.example.com/api/v1/admin/runs/wflow_abc123/events");
    expect(seen.auth).toBe("Bearer adm");
    expect(seen.body).toEqual({
      eventType: "human_approved",
      content: "Looks good — sending.",
      metadata: { staff_user: "alice", reviewed_at: "2026-04-25T10:00:30Z" },
    });
    expect(result.id).toBe("evt_appended_1");
    expect(result.runId).toBe("wflow_abc123");
    expect(result.eventType).toBe("human_approved");
  });

  it("appendEvent omits optional fields when not provided", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(String(init.body));
      return jsonResponse(201, {
        data: {
          eventId: "evt_min",
          runId: "wflow_min",
          eventType: "external_send",
        },
        metadata: { requestId: "r_min", latencyMs: 1 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    await bb.runs.appendEvent("wflow_min", { eventType: "external_send" });
    expect(seenBody).toEqual({ eventType: "external_send" });
  });

  it("get() propagates 404 from BaoBox as BaoBoxError", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(404, {
        error: { code: "NOT_FOUND", message: "Run 'wflow_x' not found", requestId: "r_404" },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });
    await expect(bb.runs.get("wflow_x")).rejects.toBeInstanceOf(BaoBoxError);
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
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
      fetch,
      timeoutMs: 10,
    });
    try {
      await bb.chat({ message: "hi" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BaoBoxError);
      expect((err as BaoBoxError).code).toBe("TIMEOUT");
    }
  });
});

describe("tools.invoke (M5 — direct tool dispatch)", () => {
  it("POSTs the right payload, sends the API key, maps the response", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit = {};
    const fetch = fakeFetch((url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(200, {
        // 0.8.1: server-side schema for /api/v1/tools/invoke is still
        // snake_case (the route is API-key gated, outside the ι epic's
        // admin/operator hard cutover). Test fixture mirrors the actual
        // server shape; the SDK maps snake → camel at the boundary.
        data: {
          tool_call_id: "tcl_abc123",
          status: "SUCCESS",
          result: { providerMessageId: "msg_42", status: "SUCCESS" },
        },
        metadata: { requestId: "req_a", latencyMs: 17 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://baobox.example.com",
      apiKey: "skb_test",
      fetch,
    });

    const result = await bb.tools.invoke({
      tool: "send_email",
      tenantId: "tnt_a",
      inputs: { to: "c@example.com", subject: "Hi", body: "B" },
    });

    expect(capturedUrl).toBe("https://baobox.example.com/api/v1/tools/invoke");
    expect((capturedInit.headers as Record<string, string>).authorization).toBe(
      "Bearer skb_test",
    );
    expect((capturedInit.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    const sentBody = JSON.parse(String(capturedInit.body));
    expect(sentBody).toEqual({
      tool: "send_email",
      tenant_id: "tnt_a",
      inputs: { to: "c@example.com", subject: "Hi", body: "B" },
    });
    expect(result.toolCallId).toBe("tcl_abc123");
    expect(result.status).toBe("SUCCESS");
    expect(result.result).toEqual({ providerMessageId: "msg_42", status: "SUCCESS" });
    expect(result.meta.requestId).toBe("req_a");
    expect(result.meta.latencyMs).toBe(17);
  });

  it("translates a 403 tenant-scope error into BaoBoxError", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(403, {
        error: {
          code: "FORBIDDEN",
          message: "API key bound to tenant 't_a' cannot invoke for tenant 't_b'",
          requestId: "req_x",
        },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://baobox.example.com",
      apiKey: "skb_test",
      fetch,
    });

    try {
      await bb.tools.invoke({ tool: "send_email", tenantId: "t_b", inputs: {} });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BaoBoxError);
      expect((err as BaoBoxError).status).toBe(403);
      expect((err as BaoBoxError).code).toBe("FORBIDDEN");
    }
  });

  it("translates a 500 handler error into BaoBoxError (e.g. NO_INTEGRATION)", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(500, {
        error: {
          code: "INTERNAL_ERROR",
          message: "An internal error occurred",
          requestId: "req_y",
        },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://baobox.example.com",
      apiKey: "skb_test",
      fetch,
    });

    try {
      await bb.tools.invoke({ tool: "send_email", tenantId: "t_a", inputs: {} });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BaoBoxError);
      expect((err as BaoBoxError).status).toBe(500);
    }
  });

  it("refuses to invoke when only adminSecret is configured (no apiKey)", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: { tool_call_id: "x", status: "SUCCESS", result: null },
        metadata: {},
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://baobox.example.com",
      adminSecret: "admin",
      fetch,
    });
    await expect(
      bb.tools.invoke({ tool: "send_email", tenantId: "t_a", inputs: {} }),
    ).rejects.toThrow(/apiKey required/);
  });
});

describe("attachments builders (0.6.0)", () => {
  it("fromUrl produces a properly-shaped url attachment", () => {
    const att = attachmentFromUrl({
      url: "https://files.example.com/signed/abc.pdf",
      filename: "statement.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1234,
      checksumSha256: "a".repeat(64),
      parseStrategy: "extract_text",
    });

    expect(att).toEqual({
      filename: "statement.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1234,
      source: {
        kind: "url",
        url: "https://files.example.com/signed/abc.pdf",
        checksumSha256: "a".repeat(64),
      },
      parseStrategy: "extract_text",
    });
  });

  it("fromUrl rejects non-https URLs", () => {
    expect(() =>
      attachmentFromUrl({ url: "http://insecure.example.com/x.pdf" }),
    ).toThrow(/https/);
  });

  it("fromInline base64-encodes bytes and stamps sizeBytes", () => {
    const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const att = attachmentFromInline({
      bytes,
      filename: "greeting.txt",
      mimeType: "text/plain",
    });

    expect(att.source).toEqual({ kind: "inline", bytesBase64: "SGVsbG8=" });
    expect(att.sizeBytes).toBe(5);
    expect(att.filename).toBe("greeting.txt");
    expect(att.mimeType).toBe("text/plain");
  });

  it("fromInline rejects payloads larger than 5 MB up-front", () => {
    const oversize = new Uint8Array(MAX_INLINE_BYTES + 1);
    expect(() => attachmentFromInline({ bytes: oversize })).toThrow(/5242880|exceeds/);
  });

  it("fromInline accepts an exact 5 MB payload", () => {
    const exact = new Uint8Array(MAX_INLINE_BYTES);
    expect(() => attachmentFromInline({ bytes: exact })).not.toThrow();
  });

  it("fromRef produces a baobox_ref attachment", () => {
    const att = attachmentFromRef({
      attId: "att_abc123def456",
      filename: "earlier.pdf",
    });
    expect(att).toEqual({
      attId: "att_abc123def456",
      filename: "earlier.pdf",
      source: { kind: "baobox_ref", attId: "att_abc123def456" },
    });
  });

  it("client.attachments.* exposes the same builders", () => {
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
    });
    const fromMethod = bb.attachments.fromUrl({ url: "https://x.example.com/y" });
    const fromStandalone = attachmentFromUrl({ url: "https://x.example.com/y" });
    expect(fromMethod).toEqual(fromStandalone);
  });
});

describe("attachments wire conversion on workflow() / chat()", () => {
  it("workflow() sends attachments[] with snake_case keys", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(String(init.body));
      return jsonResponse(200, {
        data: {
          response: "ok",
          runId: "wflow_att",
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        metadata: { requestId: "r_att", latencyMs: 10 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
      fetch,
    });

    await bb.workflow({
      skill: "sk_x",
      clientId: "c",
      requestId: "rq",
      input: "hi",
      attachments: [
        bb.attachments.fromUrl({
          url: "https://files.example.com/a.pdf",
          filename: "a.pdf",
          mimeType: "application/pdf",
          sizeBytes: 999,
          checksumSha256: "b".repeat(64),
          parseStrategy: "llamaparse",
        }),
        bb.attachments.fromInline({
          bytes: new Uint8Array([1, 2, 3]),
          filename: "blob.bin",
          mimeType: "application/octet-stream",
        }),
        bb.attachments.fromRef({ attId: "att_abc123def456", filename: "prev.pdf" }),
      ],
    });

    expect(seenBody.attachments).toEqual([
      {
        filename: "a.pdf",
        mime_type: "application/pdf",
        size_bytes: 999,
        source: {
          kind: "url",
          url: "https://files.example.com/a.pdf",
          checksum_sha256: "b".repeat(64),
        },
        parse_strategy: "llamaparse",
      },
      {
        filename: "blob.bin",
        mime_type: "application/octet-stream",
        size_bytes: 3,
        source: { kind: "inline", bytes_base64: "AQID" },
      },
      {
        att_id: "att_abc123def456",
        filename: "prev.pdf",
        source: { kind: "baobox_ref", att_id: "att_abc123def456" },
      },
    ]);
  });

  it("chat() sends attachments[] with snake_case keys", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(String(init.body));
      return jsonResponse(200, {
        data: {
          response: "ok",
          usage: { inputTokens: 1, outputTokens: 1 },
          sessionId: "ses_x",
        },
        metadata: { requestId: "r_chat_att", latencyMs: 5 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
      fetch,
    });

    await bb.chat({
      message: "hello",
      attachments: [bb.attachments.fromUrl({ url: "https://files.example.com/x.pdf" })],
    });

    expect(seenBody.attachments).toEqual([
      {
        source: { kind: "url", url: "https://files.example.com/x.pdf" },
      },
    ]);
  });

  it("omits attachments field when not provided", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(String(init.body));
      return jsonResponse(200, {
        data: {
          response: "ok",
          runId: "wflow_noatt",
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        metadata: { requestId: "r_noatt", latencyMs: 5 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
      fetch,
    });
    await bb.workflow({
      skill: "sk_x",
      clientId: "c",
      requestId: "rq",
      input: "hi",
    });
    expect("attachments" in seenBody).toBe(false);
  });

  it("omits attachments field when array is empty", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(String(init.body));
      return jsonResponse(200, {
        data: {
          response: "ok",
          runId: "wflow_empty",
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        metadata: { requestId: "r_empty", latencyMs: 5 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
      fetch,
    });
    await bb.workflow({
      skill: "sk_x",
      clientId: "c",
      requestId: "rq",
      input: "hi",
      attachments: [],
    });
    expect("attachments" in seenBody).toBe(false);
  });
});

describe("attachmentWithStrategy (0.7.0)", () => {
  it("overrides an existing parseStrategy without mutating the input", () => {
    const original = attachmentFromUrl({
      url: "https://files.example.com/a.pdf",
      filename: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1234,
      parseStrategy: "extract_text",
    });

    const overridden = attachmentWithStrategy(original, "llamaparse");

    expect(overridden.parseStrategy).toBe("llamaparse");
    // Original is untouched.
    expect(original.parseStrategy).toBe("extract_text");
    expect(overridden).not.toBe(original);
  });

  it("sets parseStrategy when none was present", () => {
    const original = attachmentFromUrl({
      url: "https://files.example.com/a.pdf",
      filename: "a.pdf",
    });
    expect(original.parseStrategy).toBeUndefined();

    const stamped = attachmentWithStrategy(original, "filename");

    expect(stamped.parseStrategy).toBe("filename");
    expect(original.parseStrategy).toBeUndefined();
  });

  it("preserves every other field across all three source kinds", () => {
    const fromUrl = attachmentFromUrl({
      url: "https://files.example.com/a.pdf",
      filename: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 999,
      checksumSha256: "c".repeat(64),
      auth: { authorization: "Bearer x" },
    });
    const fromInline = attachmentFromInline({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "blob.bin",
      mimeType: "application/octet-stream",
    });
    const fromRef = attachmentFromRef({
      attId: "att_abc123def456",
      filename: "earlier.pdf",
      mimeType: "application/pdf",
      sizeBytes: 555,
    });

    for (const att of [fromUrl, fromInline, fromRef]) {
      const next = attachmentWithStrategy(att, "auto");
      const { parseStrategy: _ignoreA, ...attRest } = att;
      const { parseStrategy: _ignoreB, ...nextRest } = next;
      expect(nextRest).toEqual(attRest);
      expect(next.parseStrategy).toBe("auto");
    }
  });

  it("accepts every ParseStrategy value", () => {
    const base = attachmentFromUrl({ url: "https://files.example.com/x.pdf" });
    const strategies: AttachmentInput["parseStrategy"][] = [
      "auto",
      "filename",
      "extract_text",
      "llamaparse",
    ];
    for (const s of strategies) {
      expect(attachmentWithStrategy(base, s!).parseStrategy).toBe(s);
    }
  });

  it("client.attachments.withStrategy matches the standalone export", () => {
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
    });
    const base = attachmentFromUrl({
      url: "https://files.example.com/a.pdf",
      filename: "a.pdf",
      mimeType: "application/pdf",
    });

    const viaMethod = bb.attachments.withStrategy(base, "llamaparse");
    const viaStandalone = attachmentWithStrategy(base, "llamaparse");

    expect(viaMethod).toEqual(viaStandalone);
  });

  it("piped attachment sends the overridden parse_strategy over the wire", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(String(init.body));
      return jsonResponse(200, {
        data: {
          response: "ok",
          runId: "wflow_ws",
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        metadata: { requestId: "r_ws", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "k",
      fetch,
    });

    const base = bb.attachments.fromUrl({
      url: "https://files.example.com/a.pdf",
      filename: "a.pdf",
      parseStrategy: "extract_text",
    });
    const pinned = bb.attachments.withStrategy(base, "llamaparse");

    await bb.workflow({
      skill: "sk_x",
      clientId: "c",
      requestId: "rq",
      input: "hi",
      attachments: [pinned],
    });

    const attachments = seenBody.attachments as Array<Record<string, unknown>>;
    expect(attachments[0]?.parse_strategy).toBe("llamaparse");
  });
});
