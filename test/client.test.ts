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

  // #254 — an apiKey-only client (the Skill Studio BFF, scoped to one tenant)
  // authenticates skills.list/get/update with the apiKey and still sends the
  // tenant scope header.
  it("uses apiKey for skills.list when no adminSecret, and sends the tenant header", async () => {
    const seen: { url?: string; auth?: string; tenant?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      const headers = init.headers as Record<string, string>;
      seen.auth = headers.authorization;
      seen.tenant = headers["X-BaoBox-Tenant-Id"];
      return jsonResponse(200, { data: [], metadata: { requestId: "r", latencyMs: 1 } });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "skb_tenant_key",
      fetch,
    });

    await bb.skills.list({ tenantId: "t_a" });
    expect(seen.url).toBe("https://api.example.com/api/v1/skills");
    expect(seen.auth).toBe("Bearer skb_tenant_key");
    expect(seen.tenant).toBe("t_a");
  });

  it("prefers adminSecret over apiKey for skills.update when both are present", async () => {
    let seenAuth = "";
    const fetch = fakeFetch((_url, init) => {
      seenAuth = (init.headers as Record<string, string>).authorization ?? "";
      return jsonResponse(200, {
        data: {
          id: "sk_1",
          name: "n",
          description: "d",
          systemPrompt: "p",
          model: "MiniMax-M2.7",
          temperature: 0.2,
          maxTokens: 4096,
          sourceUrl: null,
          tenantId: "t_a",
          createdAt: "2026-04-23T00:00:00Z",
          updatedAt: "2026-04-23T00:00:00Z",
        },
        metadata: { requestId: "r", latencyMs: 1 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "skb_key",
      adminSecret: "adm-secret",
      fetch,
    });

    await bb.skills.update("sk_1", { description: "x" }, { tenantId: "t_a" });
    expect(seenAuth).toBe("Bearer adm-secret");
  });

  it("skills.update rejects `tools` on an apiKey-only client before any write", async () => {
    let called = false;
    const fetch = fakeFetch(() => {
      called = true;
      return jsonResponse(200, { data: {}, metadata: { requestId: "r", latencyMs: 1 } });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "skb_key",
      fetch,
    });
    await expect(
      bb.skills.update("sk_1", { description: "x", tools: [] }, { tenantId: "t_a" }),
    ).rejects.toThrow(/tools requires adminSecret/);
    // No HTTP call was made — the guard runs before the field PUT.
    expect(called).toBe(false);
  });

  // #337 PR-B — llmIntegrationId forwarded in the PUT body.
  it("skills.update sends llmIntegrationId in the request body", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return jsonResponse(200, {
        data: {
          id: "sk_1",
          name: "n",
          description: "d",
          systemPrompt: "p",
          model: "gpt-5",
          temperature: 0.2,
          maxTokens: 4096,
          sourceUrl: null,
          tenantId: "t_a",
          createdAt: "2026-04-23T00:00:00Z",
          updatedAt: "2026-04-23T00:00:00Z",
        },
        metadata: { requestId: "r", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "skb_key",
      adminSecret: "adm-secret",
      fetch,
    });
    await bb.skills.update("sk_1", { llmIntegrationId: "int_x" }, { tenantId: "t_a" });
    expect(seenBody.llmIntegrationId).toBe("int_x");
  });

  // #337 PR-B — null clears the pin; compactObject must not strip null.
  it("skills.update sends llmIntegrationId: null to clear the pin", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return jsonResponse(200, {
        data: {
          id: "sk_1",
          name: "n",
          description: "d",
          systemPrompt: "p",
          model: "gpt-5",
          temperature: 0.2,
          maxTokens: 4096,
          sourceUrl: null,
          tenantId: "t_a",
          createdAt: "2026-04-23T00:00:00Z",
          updatedAt: "2026-04-23T00:00:00Z",
        },
        metadata: { requestId: "r", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "skb_key",
      adminSecret: "adm-secret",
      fetch,
    });
    await bb.skills.update("sk_1", { llmIntegrationId: null }, { tenantId: "t_a" });
    expect(Object.prototype.hasOwnProperty.call(seenBody, "llmIntegrationId")).toBe(true);
    expect(seenBody.llmIntegrationId).toBeNull();
  });

  // #257 — tenant-scoped authoring over the per-tenant apiKey.
  it("skills.create uses the apiKey path and sends the tenant header", async () => {
    const seen: { url?: string; method?: string; auth?: string; tenant?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      const headers = init.headers as Record<string, string>;
      seen.auth = headers.authorization;
      seen.tenant = headers["X-BaoBox-Tenant-Id"];
      return jsonResponse(201, {
        data: {
          id: "sk_new",
          name: "n",
          description: "",
          systemPrompt: "p",
          model: "MiniMax-M2.7",
          temperature: 0.7,
          maxTokens: 4096,
          sourceUrl: null,
          tenantId: "t_a",
          createdAt: "2026-06-06T00:00:00Z",
          updatedAt: "2026-06-06T00:00:00Z",
        },
        metadata: { requestId: "r", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", apiKey: "skb_k", fetch });
    const skill = await bb.skills.create({ name: "n", systemPrompt: "p" }, { tenantId: "t_a" });
    expect(seen.method).toBe("POST");
    expect(seen.url).toBe("https://api.example.com/api/v1/skills");
    expect(seen.auth).toBe("Bearer skb_k");
    expect(seen.tenant).toBe("t_a");
    expect(skill.tenantId).toBe("t_a");
  });

  it("skills.create rejects `tools` on an apiKey-only client before any write", async () => {
    let called = false;
    const fetch = fakeFetch(() => {
      called = true;
      return jsonResponse(201, { data: {}, metadata: { requestId: "r", latencyMs: 1 } });
    });
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", apiKey: "skb_k", fetch });
    await expect(
      bb.skills.create({ name: "n", systemPrompt: "p", tools: ["tool_x"] }, { tenantId: "t_a" }),
    ).rejects.toThrow(/requires adminSecret/);
    expect(called).toBe(false);
  });

  it("skills.attachSkill POSTs the attached-skills route via apiKey + tenant header", async () => {
    const seen: { url?: string; method?: string; auth?: string; tenant?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      const headers = init.headers as Record<string, string>;
      seen.auth = headers.authorization;
      seen.tenant = headers["X-BaoBox-Tenant-Id"];
      return jsonResponse(200, { data: { attached: true }, metadata: { requestId: "r", latencyMs: 1 } });
    });
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", apiKey: "skb_k", fetch });
    const res = await bb.skills.attachSkill("sk_parent", "sk_child", { tenantId: "t_a" });
    expect(res.attached).toBe(true);
    expect(seen.method).toBe("POST");
    expect(seen.url).toBe("https://api.example.com/api/v1/skills/sk_parent/attached-skills/sk_child");
    expect(seen.auth).toBe("Bearer skb_k");
    expect(seen.tenant).toBe("t_a");
  });

  it("skills.detachSkill DELETEs the attached-skills route", async () => {
    const seen: { url?: string; method?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      return jsonResponse(200, { data: { detached: true }, metadata: { requestId: "r", latencyMs: 1 } });
    });
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", apiKey: "skb_k", fetch });
    const res = await bb.skills.detachSkill("sk_parent", "sk_child");
    expect(res.detached).toBe(true);
    expect(seen.method).toBe("DELETE");
    expect(seen.url).toBe("https://api.example.com/api/v1/skills/sk_parent/attached-skills/sk_child");
  });

  it("skills.attachTool POSTs the tools route via apiKey (lifts adminSecret requirement)", async () => {
    const seen: { url?: string; method?: string; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, { data: { attached: true }, metadata: { requestId: "r", latencyMs: 1 } });
    });
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", apiKey: "skb_k", fetch });
    const res = await bb.skills.attachTool("sk_1", "tool_send_email", { tenantId: "t_a" });
    expect(res.attached).toBe(true);
    expect(seen.method).toBe("POST");
    expect(seen.url).toBe("https://api.example.com/api/v1/skills/sk_1/tools/tool_send_email");
    expect(seen.auth).toBe("Bearer skb_k");
  });

  it("skills.detachTool DELETEs the tools route", async () => {
    const seen: { url?: string; method?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      return jsonResponse(200, { data: { detached: true }, metadata: { requestId: "r", latencyMs: 1 } });
    });
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", apiKey: "skb_k", fetch });
    const res = await bb.skills.detachTool("sk_1", "tool_send_email");
    expect(res.detached).toBe(true);
    expect(seen.method).toBe("DELETE");
    expect(seen.url).toBe("https://api.example.com/api/v1/skills/sk_1/tools/tool_send_email");
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

  it("forwards modelOverride on eval.run and drops it when omitted", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = fakeFetch((_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return jsonResponse(200, {
        data: {
          evalRunId: "run_1",
          status: "completed",
          totalCases: 1,
          passed: 1,
          failed: 0,
          avgScore: 4,
          results: [],
          durationMs: 12,
        },
        metadata: { requestId: "r_run", latencyMs: 12 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const run = await bb.eval.run({ skillId: "sk_1", modelOverride: "provider/model-x" });
    expect(bodies[0]).toEqual({ skillId: "sk_1", modelOverride: "provider/model-x" });
    expect(run.runId).toBe("run_1");

    await bb.eval.run({ skillId: "sk_1" });
    // compactObject must drop the absent override entirely.
    expect(bodies[1]).not.toHaveProperty("modelOverride");
    expect(bodies[1]).toEqual({ skillId: "sk_1" });
  });

  it("forwards T8/T9 case fields and maps them back; null clears, undefined drops", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = fakeFetch((_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return jsonResponse(201, {
        data: {
          evalCaseId: "case_1",
          skillId: "sk_1",
          name: "captured",
          input: "in",
          expectedBehavior: "behaves",
          expectedOutput: "exact text",
          dimensions: "accuracy",
          passingThreshold: 3,
          sourceSessionId: "sess_1",
          matchMode: "exact",
          createdAt: "2026-06-27T00:00:00Z",
          updatedAt: "2026-06-27T00:00:00Z",
        },
        metadata: { requestId: "r_case", latencyMs: 0 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const created = await bb.eval.tests.create("sk_1", {
      name: "captured",
      input: "in",
      expectedBehavior: "behaves",
      matchMode: "exact",
      expectedOutput: "exact text",
      sourceSessionId: "sess_1",
    });
    expect(bodies[0]).toEqual({
      name: "captured",
      input: "in",
      expectedBehavior: "behaves",
      matchMode: "exact",
      expectedOutput: "exact text",
      sourceSessionId: "sess_1",
    });
    expect(created.matchMode).toBe("exact");
    expect(created.expectedOutput).toBe("exact text");
    expect(created.sourceSessionId).toBe("sess_1");

    // null is preserved (clear); the omitted matchMode is dropped.
    await bb.eval.tests.create("sk_1", {
      name: "judge case",
      input: "in",
      expectedBehavior: "behaves",
      expectedOutput: null,
    });
    expect(bodies[1]).toEqual({
      name: "judge case",
      input: "in",
      expectedBehavior: "behaves",
      expectedOutput: null,
    });
    expect(bodies[1]).not.toHaveProperty("matchMode");
    expect(bodies[1]).not.toHaveProperty("sourceSessionId");
  });

  it("tolerates older backends that omit the new EvalCase fields", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: [
          {
            evalCaseId: "case_legacy",
            skillId: "sk_1",
            name: "legacy",
            input: "in",
            expectedBehavior: "behaves",
            dimensions: "accuracy",
            passingThreshold: 3,
            createdAt: "2026-06-27T00:00:00Z",
            updatedAt: "2026-06-27T00:00:00Z",
          },
        ],
        metadata: { requestId: "r_list", latencyMs: 0 },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });
    const cases = await bb.eval.tests.list("sk_1");
    const c = cases[0]!;
    expect(c.matchMode).toBe("judge");
    expect(c.expectedOutput).toBeNull();
    expect(c.sourceSessionId).toBeNull();
  });

  it("eval.draftFromEvent posts the event id and assist flag, maps the draft", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetch = fakeFetch((url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return jsonResponse(200, {
        data: {
          skillId: "sk_1",
          sourceSessionId: "sess_1",
          suggestedName: "Draft from turn",
          input: "user input",
          referenceOutput: "assistant output",
          fullMessages: [{ role: "user", content: "user input" }],
          llmContext: { model: "provider/model-x", tokenCount: 42, latencyMs: 100 },
          suggestedMatchMode: "judge",
          assist: {
            copyablePrompt: "Write a test that...",
            assisted: true,
            suggested: {
              name: "Refined name",
              expectedBehavior: "behaves well",
              dimensions: ["accuracy"],
            },
          },
        },
        metadata: { requestId: "r_draft", latencyMs: 0 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const draft = await bb.eval.draftFromEvent("evt_1", { assist: true });
    expect(calls[0]!.url).toBe("https://api.example.com/api/v1/eval/draft-from-event");
    expect(calls[0]!.body).toEqual({ eventId: "evt_1", assist: true });
    expect(draft.skillId).toBe("sk_1");
    expect(draft.referenceOutput).toBe("assistant output");
    expect(draft.suggestedMatchMode).toBe("judge");
    expect(draft.llmContext.tokenCount).toBe(42);
    expect(draft.assist?.suggested?.name).toBe("Refined name");

    // assist omitted → compactObject drops it.
    await bb.eval.draftFromEvent("evt_2");
    expect(calls[1]!.body).toEqual({ eventId: "evt_2" });
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

});

// ─── 0.18.0 — LLM model catalog ──────────────────────────────────────────────
describe("catalog.list (0.18.0)", () => {
  it("GETs /api/v1/llm-providers with adminSecret and returns unwrapped data", async () => {
    const seen: { url?: string; method?: string; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, {
        data: {
          providers: [
            {
              id: "openai",
              displayName: "OpenAI",
              defaultModel: "openai/gpt-5",
              docsUrl: "https://platform.openai.com/docs",
              pricingUrl: "https://openai.com/pricing",
              models: [
                {
                  id: "openai/gpt-5",
                  displayName: "GPT-5",
                  paramProfile: "reasoning",
                  reasoningEfforts: ["low", "medium", "high"],
                  contextWindow: 200000,
                  pricing: {
                    inputUsdPerMTok: 2.5,
                    outputUsdPerMTok: 10,
                    asOf: "2026-06-01",
                  },
                },
                {
                  id: "openai/gpt-5-mini",
                  displayName: "GPT-5 Mini",
                  paramProfile: "sampling",
                  contextWindow: 128000,
                },
              ],
            },
          ],
          reasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
        metadata: { requestId: "r_cat", latencyMs: 8 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm-secret",
      fetch,
    });

    const catalog = await bb.catalog.list();
    expect(seen.method).toBe("GET");
    expect(seen.url).toBe("https://api.example.com/api/v1/llm-providers");
    expect(seen.auth).toBe("Bearer adm-secret");
    expect(catalog.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(catalog.providers).toHaveLength(1);
    const [provider] = catalog.providers;
    expect(provider?.id).toBe("openai");
    expect(provider?.defaultModel).toBe("openai/gpt-5");
    expect(provider?.models).toHaveLength(2);
    const [reasoning, sampling] = provider!.models;
    expect(reasoning?.paramProfile).toBe("reasoning");
    expect(reasoning?.reasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(reasoning?.pricing?.inputUsdPerMTok).toBe(2.5);
    expect(sampling?.paramProfile).toBe("sampling");
    expect(sampling?.contextWindow).toBe(128000);
    expect(sampling?.pricing).toBeUndefined();
  });

  it("propagates 401 as BaoBoxError when called with apiKey-only client", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "adminSecret required", requestId: "r_401" },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });
    await expect(bb.catalog.list()).rejects.toBeInstanceOf(BaoBoxError);
  });
});

// ─── B1 (0.12.0) — guardrail config surfaces ───────────────────────────────
describe("skills.updateGuardrails (B1)", () => {
  it("PATCHes the admin guardrails route with addenda only and bearer auth", async () => {
    const seen: { url?: string; method?: string; body?: unknown; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      seen.body = JSON.parse(String(init.body));
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, {
        data: {
          skillId: "sk_demo",
          preflightDisabled: 0,
          postflightDisabled: 0,
          preflightAddendum: "Only answer invoice questions.",
          postflightAddendum: null,
          isSystem: 0,
        },
        metadata: { requestId: "r_guard_t", latencyMs: 4 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const result = await bb.skills.updateGuardrails("sk_demo", {
      preflightAddendum: "Only answer invoice questions.",
      postflightAddendum: null,
    });

    expect(seen.method).toBe("PATCH");
    expect(seen.url).toBe("https://api.example.com/api/v1/admin/skills/sk_demo/guardrails");
    expect(seen.auth).toBe("Bearer adm");
    expect(seen.body).toEqual({
      preflightAddendum: "Only answer invoice questions.",
      postflightAddendum: null,
    });
    expect(result).toEqual({
      skillId: "sk_demo",
      preflightAddendum: "Only answer invoice questions.",
      postflightAddendum: null,
    });
  });

  it("URL-encodes skill ids with special characters", async () => {
    const calls: string[] = [];
    const fetch = fakeFetch((url) => {
      calls.push(url);
      return jsonResponse(200, {
        data: {
          skillId: "sk/weird id",
          preflightDisabled: 0,
          postflightDisabled: 0,
          preflightAddendum: "x",
          postflightAddendum: null,
          isSystem: 0,
        },
        metadata: { requestId: "r_enc", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    await bb.skills.updateGuardrails("sk/weird id", { preflightAddendum: "x" });
    expect(calls[0]).toBe(
      "https://api.example.com/api/v1/admin/skills/sk%2Fweird%20id/guardrails",
    );
  });

  it("omits undefined fields from the wire body", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(String(init.body));
      return jsonResponse(200, {
        data: {
          skillId: "sk_demo",
          preflightDisabled: 0,
          postflightDisabled: 0,
          preflightAddendum: "only-pre",
          postflightAddendum: null,
          isSystem: 0,
        },
        metadata: { requestId: "r_omit", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    await bb.skills.updateGuardrails("sk_demo", {
      preflightAddendum: "only-pre",
    });
    expect(seenBody).toEqual({ preflightAddendum: "only-pre" });
    expect("postflightAddendum" in seenBody).toBe(false);
  });
});

describe("admin.skills.setGuardrailDisabled (B1)", () => {
  it("PATCHes the admin route with flags + addenda and surfaces isSystem", async () => {
    const seen: { url?: string; method?: string; body?: unknown; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      seen.body = JSON.parse(String(init.body));
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, {
        data: {
          skillId: "sk_sys_preflight_v1",
          preflightDisabled: 1,
          postflightDisabled: 0,
          preflightAddendum: null,
          postflightAddendum: "loosen redaction",
          isSystem: 1,
        },
        metadata: { requestId: "r_guard_a", latencyMs: 5 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const result = await bb.admin.skills.setGuardrailDisabled("sk_sys_preflight_v1", {
      preflightDisabled: true,
      postflightAddendum: "loosen redaction",
    });

    expect(seen.method).toBe("PATCH");
    expect(seen.url).toBe(
      "https://api.example.com/api/v1/admin/skills/sk_sys_preflight_v1/guardrails",
    );
    expect(seen.auth).toBe("Bearer adm");
    expect(seen.body).toEqual({
      preflightDisabled: true,
      postflightAddendum: "loosen redaction",
    });
    expect(result).toEqual({
      skillId: "sk_sys_preflight_v1",
      preflightDisabled: 1,
      postflightDisabled: 0,
      preflightAddendum: null,
      postflightAddendum: "loosen redaction",
      isSystem: 1,
    });
  });

  it("supports clearing addenda by passing null", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(String(init.body));
      return jsonResponse(200, {
        data: {
          skillId: "sk_demo",
          preflightDisabled: 0,
          postflightDisabled: 0,
          preflightAddendum: null,
          postflightAddendum: null,
          isSystem: 0,
        },
        metadata: { requestId: "r_clear", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    await bb.admin.skills.setGuardrailDisabled("sk_demo", {
      preflightAddendum: null,
      postflightAddendum: null,
    });
    expect(seenBody).toEqual({
      preflightAddendum: null,
      postflightAddendum: null,
    });
  });

  it("propagates 404 as BaoBoxError with skill_not_found code", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(404, {
        error: { code: "skill_not_found", message: "Skill 'sk_missing' not found" },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    await expect(
      bb.admin.skills.setGuardrailDisabled("sk_missing", { preflightDisabled: true }),
    ).rejects.toMatchObject({
      status: 404,
      code: "skill_not_found",
    });
  });
});

// ─── D1 (0.12.0) — session metadata + actorUserId attribution ──────────────
describe("sessions.updateMetadata (D1)", () => {
  it("PATCHes /api/v1/sessions/:id/metadata with the metadata blob", async () => {
    const seen: { url?: string; method?: string; body?: unknown; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      seen.body = JSON.parse(String(init.body));
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, {
        data: {
          sessionId: "ses_demo",
          metadata: { staffUserId: "usr_demo", clientRef: "client_demo" },
        },
        metadata: { requestId: "r_md", latencyMs: 3 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const result = await bb.sessions.updateMetadata("ses_demo", {
      staffUserId: "usr_demo",
      clientRef: "client_demo",
    });

    expect(seen.method).toBe("PATCH");
    expect(seen.url).toBe("https://api.example.com/api/v1/sessions/ses_demo/metadata");
    expect(seen.auth).toBe("Bearer adm");
    expect(seen.body).toEqual({
      staffUserId: "usr_demo",
      clientRef: "client_demo",
    });
    expect(result).toEqual({
      sessionId: "ses_demo",
      metadata: { staffUserId: "usr_demo", clientRef: "client_demo" },
    });
  });

  it("URL-encodes session ids", async () => {
    const calls: string[] = [];
    const fetch = fakeFetch((url) => {
      calls.push(url);
      return jsonResponse(200, {
        data: { sessionId: "ses with space", metadata: {} },
        metadata: { requestId: "r_md_enc", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });
    await bb.sessions.updateMetadata("ses with space", { foo: 1 });
    expect(calls[0]).toBe(
      "https://api.example.com/api/v1/sessions/ses%20with%20space/metadata",
    );
  });

  it("propagates 413 ATTACHMENT_TOO_LARGE-equivalent body cap errors", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(413, {
        error: { code: "metadata_too_large", message: "metadata blob exceeds 65536 bytes" },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });
    await expect(bb.sessions.updateMetadata("ses_big", { huge: "x" })).rejects.toMatchObject({
      status: 413,
      code: "metadata_too_large",
    });
  });
});

describe("sessions.create (#239 — tenant binding)", () => {
  it("sends tenantId in the request body and surfaces it on the returned session", async () => {
    const seen: { url?: string; body?: Record<string, unknown>; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.body = JSON.parse(String(init.body)) as Record<string, unknown>;
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(201, {
        data: {
          sessionId: "ses_new",
          skillId: "sk_test",
          tenantId: "tenant_99",
          createdAt: "2026-06-06T00:00:00Z",
          updatedAt: "2026-06-06T00:00:00Z",
        },
        metadata: { requestId: "r_create", latencyMs: 3 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const session = await bb.sessions.create({ skillId: "sk_test", tenantId: "tenant_99" });

    expect(seen.url).toBe("https://api.example.com/api/v1/sessions");
    expect(seen.body).toEqual({ skillId: "sk_test", tenantId: "tenant_99" });
    expect(seen.auth).toBe("Bearer adm");
    expect(session.tenantId).toBe("tenant_99");
    expect(session.id).toBe("ses_new");
  });

  it("omits tenantId from the body when not supplied (unscoped session)", async () => {
    let sentBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      sentBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse(201, {
        data: {
          sessionId: "ses_plain",
          skillId: "sk_test",
          tenantId: null,
          createdAt: "2026-06-06T00:00:00Z",
          updatedAt: "2026-06-06T00:00:00Z",
        },
        metadata: { requestId: "r_create2", latencyMs: 2 },
      });
    });

    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const session = await bb.sessions.create({ skillId: "sk_test" });
    expect("tenantId" in sentBody).toBe(false);
    expect(session.tenantId).toBeNull();
  });
});

describe("sessions.get + timeline (D1 — metadata + actorUserId)", () => {
  it("surfaces Session.metadata when the server returns it", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: {
          sessionId: "ses_demo",
          skillId: "sk_demo",
          tenantId: "t_demo",
          createdAt: "2026-05-30T00:00:00Z",
          updatedAt: "2026-05-30T00:00:00Z",
          metadata: { staffUserId: "usr_demo" },
        },
        metadata: { requestId: "r_get", latencyMs: 1 },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });
    const session = await bb.sessions.get("ses_demo");
    expect(session.metadata).toEqual({ staffUserId: "usr_demo" });
  });

  it("omits metadata field when the server omits it (pre-D1 compat)", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: {
          sessionId: "ses_legacy",
          skillId: "sk_demo",
          tenantId: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        metadata: { requestId: "r_legacy", latencyMs: 1 },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });
    const session = await bb.sessions.get("ses_legacy");
    expect("metadata" in session).toBe(false);
  });

  it("propagates Session.metadata: null when explicitly null on the wire", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: {
          sessionId: "ses_cleared",
          skillId: "sk_demo",
          tenantId: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          metadata: null,
        },
        metadata: { requestId: "r_clear", latencyMs: 1 },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });
    const session = await bb.sessions.get("ses_cleared");
    expect(session.metadata).toBeNull();
  });

  it("surfaces actorUserId on timeline events when present", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: {
          sessionId: "ses_demo",
          events: [
            {
              eventId: "evt_1",
              sessionId: "ses_demo",
              requestId: "r_1",
              runId: null,
              eventType: "user_message",
              content: "hi",
              metadata: "{}",
              tokenCount: 0,
              latencyMs: 0,
              parentEventId: null,
              createdAt: "2026-05-30T00:00:00Z",
              actorUserId: "alice@example.com",
            },
            {
              eventId: "evt_2",
              sessionId: "ses_demo",
              requestId: "r_1",
              runId: null,
              eventType: "preflight_pass",
              content: null,
              metadata: '{"latency_ms":12,"model":"m","severity":"low"}',
              tokenCount: 0,
              latencyMs: 12,
              parentEventId: null,
              createdAt: "2026-05-30T00:00:01Z",
              actorUserId: null,
            },
          ],
        },
        metadata: { requestId: "r_tl", latencyMs: 1 },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });
    const timeline = await bb.sessions.timeline("ses_demo");
    expect(timeline.events).toHaveLength(2);
    expect(timeline.events[0]?.actorUserId).toBe("alice@example.com");
    expect(timeline.events[1]?.actorUserId).toBeNull();
    expect(timeline.events[1]?.eventType).toBe("preflight_pass");
  });

  it("omits actorUserId on pre-D1 server responses", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: {
          sessionId: "ses_legacy",
          events: [
            {
              eventId: "evt_legacy",
              sessionId: "ses_legacy",
              requestId: "r_1",
              runId: null,
              eventType: "user_message",
              content: "hi",
              metadata: "{}",
              tokenCount: 0,
              latencyMs: 0,
              parentEventId: null,
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
        metadata: { requestId: "r_tl_legacy", latencyMs: 1 },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });
    const timeline = await bb.sessions.timeline("ses_legacy");
    expect(timeline.events).toHaveLength(1);
    expect("actorUserId" in (timeline.events[0] ?? {})).toBe(false);
  });

  it("accepts the new B1 EventType values on the timeline", async () => {
    const guardrailEventTypes = [
      "preflight_pass",
      "preflight_block",
      "postflight_pass",
      "postflight_redact",
      "postflight_block",
      "postflight_retry_triggered",
      "postflight_retry_exhausted",
      "postflight_retry_skipped_side_effects",
      "guardrail_disabled",
      "refusal_emitted",
      "injection_detected",
    ];
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: {
          sessionId: "ses_demo",
          events: guardrailEventTypes.map((eventType, i) => ({
            eventId: `evt_${i}`,
            sessionId: "ses_demo",
            requestId: "r_1",
            runId: null,
            eventType,
            content: null,
            metadata: "{}",
            tokenCount: 0,
            latencyMs: 1,
            parentEventId: null,
            createdAt: "2026-05-30T00:00:00Z",
          })),
        },
        metadata: { requestId: "r_b1", latencyMs: 1 },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });
    const timeline = await bb.sessions.timeline("ses_demo");
    expect(timeline.events.map((e) => e.eventType)).toEqual(guardrailEventTypes);
  });
});

describe("legacy parse-strategy piping (round-trip)", () => {
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

describe("skills tenant scope (#247)", () => {
  const rawSkill = {
    id: "sk_1",
    name: "Chaser",
    description: "desc",
    systemPrompt: "prompt",
    model: "MiniMax-M2.7",
    temperature: 0.2,
    maxTokens: 4096,
    sourceUrl: null,
    tenantId: "t_acme",
    createdAt: "2026-04-23T00:00:00Z",
    updatedAt: "2026-04-23T00:00:00Z",
  };

  function headerOf(init: RequestInit, name: string): string | undefined {
    return (init.headers as Record<string, string>)[name];
  }

  it("skills.list({ tenantId }) sends X-BaoBox-Tenant-Id", async () => {
    const seen: { url?: string; tenant?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.tenant = headerOf(init, "X-BaoBox-Tenant-Id");
      return jsonResponse(200, { data: [rawSkill], metadata: { requestId: "r", latencyMs: 1 } });
    });
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", adminSecret: "s", fetch });

    await bb.skills.list({ tenantId: "t_acme" });
    expect(seen.url).toBe("https://api.example.com/api/v1/skills");
    expect(seen.tenant).toBe("t_acme");
  });

  it("skills.list() omits the scope header (cross-tenant default)", async () => {
    let tenant: string | undefined = "unset";
    const fetch = fakeFetch((_url, init) => {
      tenant = headerOf(init, "X-BaoBox-Tenant-Id");
      return jsonResponse(200, { data: [rawSkill], metadata: { requestId: "r", latencyMs: 1 } });
    });
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", adminSecret: "s", fetch });

    await bb.skills.list();
    expect(tenant).toBeUndefined();
  });

  it("skills.get(id, { tenantId }) sends the scope header on the right URL", async () => {
    const seen: { url?: string; tenant?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.tenant = headerOf(init, "X-BaoBox-Tenant-Id");
      return jsonResponse(200, {
        data: { ...rawSkill, files: [] },
        metadata: { requestId: "r", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", adminSecret: "s", fetch });

    await bb.skills.get("sk_1", { tenantId: "t_acme" });
    expect(seen.url).toBe("https://api.example.com/api/v1/skills/sk_1");
    expect(seen.tenant).toBe("t_acme");
  });

  it("skills.update(id, req, { tenantId }) sends the scope header on the PUT", async () => {
    const seen: { url?: string; method?: string; tenant?: string; body?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      seen.tenant = headerOf(init, "X-BaoBox-Tenant-Id");
      seen.body = init.body as string;
      return jsonResponse(200, { data: rawSkill, metadata: { requestId: "r", latencyMs: 1 } });
    });
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", adminSecret: "s", fetch });

    await bb.skills.update("sk_1", { description: "edited" }, { tenantId: "t_acme" });
    expect(seen.url).toBe("https://api.example.com/api/v1/skills/sk_1");
    expect(seen.method).toBe("PUT");
    expect(seen.tenant).toBe("t_acme");
    expect(JSON.parse(seen.body ?? "{}").description).toBe("edited");
  });

  it("skills.update without options omits the scope header", async () => {
    let tenant: string | undefined = "unset";
    const fetch = fakeFetch((_url, init) => {
      tenant = headerOf(init, "X-BaoBox-Tenant-Id");
      return jsonResponse(200, { data: rawSkill, metadata: { requestId: "r", latencyMs: 1 } });
    });
    const bb = new BaoBoxClient({ endpoint: "https://api.example.com", adminSecret: "s", fetch });

    await bb.skills.update("sk_1", { description: "edited" });
    expect(tenant).toBeUndefined();
  });
});

// #301 — reasoningEffort on skill create/update/read
describe("skill reasoningEffort (#301)", () => {
  const rawSkillBase = {
    skillId: "sk_re",
    name: "ReasoningSkill",
    description: "desc",
    systemPrompt: "prompt",
    model: "model-x",
    temperature: 0.5,
    maxTokens: 2048,
    sourceUrl: null,
    tenantId: null,
    createdAt: "2026-06-13T00:00:00Z",
    updatedAt: "2026-06-13T00:00:00Z",
  };

  it("skills.create sends reasoningEffort on the wire when supplied", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return jsonResponse(201, {
        data: { ...rawSkillBase, reasoningEffort: "high" },
        metadata: { requestId: "r_re1", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const skill = await bb.skills.create({
      name: "ReasoningSkill",
      systemPrompt: "prompt",
      reasoningEffort: "high",
    });

    expect(seenBody.reasoningEffort).toBe("high");
    expect(skill.reasoningEffort).toBe("high");
  });

  it("skills.create omits reasoningEffort from the wire when not supplied", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return jsonResponse(201, {
        data: rawSkillBase,
        metadata: { requestId: "r_re2", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const skill = await bb.skills.create({ name: "ReasoningSkill", systemPrompt: "prompt" });

    expect("reasoningEffort" in seenBody).toBe(false);
    expect("reasoningEffort" in skill).toBe(false);
  });

  it("skills.update sends reasoningEffort on the wire when supplied", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return jsonResponse(200, {
        data: { ...rawSkillBase, reasoningEffort: "medium" },
        metadata: { requestId: "r_re3", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const skill = await bb.skills.update("sk_re", { reasoningEffort: "medium" });

    expect(seenBody.reasoningEffort).toBe("medium");
    expect(skill.reasoningEffort).toBe("medium");
  });

  it("Skill.reasoningEffort is absent when the server omits it (pre-#301 compat)", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: [rawSkillBase],
        metadata: { requestId: "r_re4", latencyMs: 1 },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const [skill] = await bb.skills.list();
    expect("reasoningEffort" in (skill ?? {})).toBe(false);
  });

  it("skills.create sends reasoningEffort 'none' on the wire (xhigh-tier model compat)", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return jsonResponse(201, {
        data: { ...rawSkillBase, reasoningEffort: "none" },
        metadata: { requestId: "r_re5", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const skill = await bb.skills.create({
      name: "ReasoningSkill",
      systemPrompt: "prompt",
      reasoningEffort: "none",
    });

    expect(seenBody.reasoningEffort).toBe("none");
    expect(skill.reasoningEffort).toBe("none");
  });

  it("skills.update sends reasoningEffort 'xhigh' on the wire (xhigh-tier model compat)", async () => {
    let seenBody: Record<string, unknown> = {};
    const fetch = fakeFetch((_url, init) => {
      seenBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return jsonResponse(200, {
        data: { ...rawSkillBase, reasoningEffort: "xhigh" },
        metadata: { requestId: "r_re6", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const skill = await bb.skills.update("sk_re", { reasoningEffort: "xhigh" });

    expect(seenBody.reasoningEffort).toBe("xhigh");
    expect(skill.reasoningEffort).toBe("xhigh");
  });
});

// ─── skills.roleModels (0.19.0) ───────────────────────────────────────────────

describe("skills.roleModels", () => {
  const rawRoleModelsMap = {
    main: [
      {
        skillId: "sk_1",
        role: "main",
        position: 0,
        llmIntegrationId: "int_abc",
        model: "openai/gpt-5",
        llmSource: "pinned",
      },
    ],
    preflight_guard: [],
    postflight_guard: [],
    eval_judge: [],
  };

  it("roleModels.get hits GET /api/v1/skills/:id/role-models and returns unwrapped map", async () => {
    const seen: { url?: string; method?: string; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, {
        data: rawRoleModelsMap,
        metadata: { requestId: "r_rm1", latencyMs: 3 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm-secret",
      fetch,
    });

    const map = await bb.skills.roleModels.get("sk_1");

    expect(seen.method).toBe("GET");
    expect(seen.url).toBe("https://api.example.com/api/v1/skills/sk_1/role-models");
    expect(seen.auth).toBe("Bearer adm-secret");
    expect(map.main).toHaveLength(1);
    expect(map.main[0]?.role).toBe("main");
    expect(map.main[0]?.llmSource).toBe("pinned");
    expect(map.preflight_guard).toEqual([]);
  });

  it("roleModels.get uses apiKey when no adminSecret and sends tenant header", async () => {
    const seen: { url?: string; auth?: string; tenant?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      const headers = init.headers as Record<string, string>;
      seen.auth = headers.authorization;
      seen.tenant = headers["X-BaoBox-Tenant-Id"];
      return jsonResponse(200, {
        data: rawRoleModelsMap,
        metadata: { requestId: "r_rm2", latencyMs: 2 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "skb_tenant_key",
      fetch,
    });

    await bb.skills.roleModels.get("sk_1", { tenantId: "t_abc" });

    expect(seen.url).toBe("https://api.example.com/api/v1/skills/sk_1/role-models");
    expect(seen.auth).toBe("Bearer skb_tenant_key");
    expect(seen.tenant).toBe("t_abc");
  });

  it("roleModels.put hits PUT /api/v1/skills/:id/role-models with the right body and returns unwrapped result", async () => {
    const seen: { url?: string; method?: string; body?: unknown; auth?: string } = {};
    const rawPutResponse = {
      role: "postflight_guard",
      chain: [
        {
          skillId: "sk_1",
          role: "postflight_guard",
          position: 0,
          llmIntegrationId: null,
          model: "openai/gpt-5-mini",
          llmSource: "platform",
        },
      ],
    };
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      seen.body = JSON.parse(init.body as string);
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, {
        data: rawPutResponse,
        metadata: { requestId: "r_rm3", latencyMs: 4 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm-secret",
      fetch,
    });

    const result = await bb.skills.roleModels.put("sk_1", {
      role: "postflight_guard",
      chain: [{ llmIntegrationId: null, model: "openai/gpt-5-mini", llmSource: "platform" }],
    });

    expect(seen.method).toBe("PUT");
    expect(seen.url).toBe("https://api.example.com/api/v1/skills/sk_1/role-models");
    expect(seen.auth).toBe("Bearer adm-secret");
    expect(seen.body).toEqual({
      role: "postflight_guard",
      chain: [{ llmIntegrationId: null, model: "openai/gpt-5-mini", llmSource: "platform" }],
    });
    expect(result.role).toBe("postflight_guard");
    expect(result.chain).toHaveLength(1);
    expect(result.chain[0]?.position).toBe(0);
    expect(result.chain[0]?.llmSource).toBe("platform");
  });

  it("roleModels.put uses apiKey and sends tenant scope header", async () => {
    const seen: { auth?: string; tenant?: string } = {};
    const fetch = fakeFetch((_url, init) => {
      const headers = init.headers as Record<string, string>;
      seen.auth = headers.authorization;
      seen.tenant = headers["X-BaoBox-Tenant-Id"];
      return jsonResponse(200, {
        data: { role: "main", chain: [] },
        metadata: { requestId: "r_rm4", latencyMs: 1 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "skb_tenant_key",
      fetch,
    });

    await bb.skills.roleModels.put(
      "sk_1",
      { role: "main", chain: [{ llmIntegrationId: "int_x", model: null, llmSource: "tenant_default" }] },
      { tenantId: "t_xyz" },
    );

    expect(seen.auth).toBe("Bearer skb_tenant_key");
    expect(seen.tenant).toBe("t_xyz");
  });
});

// ─── 0.20.0 — LLM integrations ────────────────────────────────────────────────

describe("llmIntegrations.list (0.20.0)", () => {
  const rawIntegrations = [
    {
      id: "int_abc",
      displayName: "Acme OpenAI",
      provider: "openai",
      defaultModel: "openai/gpt-5",
      isDefault: true,
      apiKeyMask: "***",
    },
    {
      id: "int_def",
      displayName: "Acme Anthropic",
      provider: "anthropic",
      defaultModel: "anthropic/claude-opus-4",
      isDefault: false,
      apiKeyMask: "***",
    },
  ];

  it("GETs /api/v1/llm-integrations with adminSecret and returns unwrapped array", async () => {
    const seen: { url?: string; method?: string; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, {
        data: rawIntegrations,
        metadata: { requestId: "r_int1", latencyMs: 5 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm-secret",
      fetch,
    });

    const integrations = await bb.llmIntegrations.list();

    expect(seen.method).toBe("GET");
    expect(seen.url).toBe("https://api.example.com/api/v1/llm-integrations");
    expect(seen.auth).toBe("Bearer adm-secret");
    expect(integrations).toHaveLength(2);
    const [first, second] = integrations;
    expect(first?.id).toBe("int_abc");
    expect(first?.provider).toBe("openai");
    expect(first?.isDefault).toBe(true);
    expect(first?.apiKeyMask).toBe("***");
    expect(second?.id).toBe("int_def");
    expect(second?.isDefault).toBe(false);
  });

  it("uses apiKey when no adminSecret and sends X-BaoBox-Tenant-Id header", async () => {
    const seen: { url?: string; auth?: string; tenant?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      const headers = init.headers as Record<string, string>;
      seen.auth = headers.authorization;
      seen.tenant = headers["X-BaoBox-Tenant-Id"];
      return jsonResponse(200, {
        data: rawIntegrations,
        metadata: { requestId: "r_int2", latencyMs: 3 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "skb_tenant_key",
      fetch,
    });

    await bb.llmIntegrations.list({ tenantId: "t_abc" });

    expect(seen.url).toBe("https://api.example.com/api/v1/llm-integrations");
    expect(seen.auth).toBe("Bearer skb_tenant_key");
    expect(seen.tenant).toBe("t_abc");
  });
});

describe("llmIntegrations.listModels (0.20.0)", () => {
  const rawModelsView = {
    integrationId: "int_abc",
    provider: "openai",
    models: [
      {
        id: "openai/gpt-5",
        displayName: "GPT-5",
        source: "catalog",
        paramProfile: "reasoning",
        reasoningEfforts: ["low", "medium", "high"],
        pricing: { inputUsdPerMTok: 2.5, outputUsdPerMTok: 10, asOf: "2026-06-01" },
      },
      {
        id: "openai/gpt-5-mini",
        displayName: "GPT-5 Mini",
        source: "provider",
        paramProfile: "sampling",
        reasoningEfforts: [],
        pricing: null,
      },
    ],
    providerListError: null,
  };

  it("GETs /api/v1/llm-integrations/:id/models with adminSecret and returns unwrapped view", async () => {
    const seen: { url?: string; method?: string; auth?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      seen.method = init.method;
      seen.auth = (init.headers as Record<string, string>).authorization;
      return jsonResponse(200, {
        data: rawModelsView,
        metadata: { requestId: "r_mod1", latencyMs: 6 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm-secret",
      fetch,
    });

    const view = await bb.llmIntegrations.listModels("int_abc");

    expect(seen.method).toBe("GET");
    expect(seen.url).toBe(
      "https://api.example.com/api/v1/llm-integrations/int_abc/models",
    );
    expect(seen.auth).toBe("Bearer adm-secret");
    expect(view.integrationId).toBe("int_abc");
    expect(view.provider).toBe("openai");
    expect(view.providerListError).toBeNull();
    expect(view.models).toHaveLength(2);
    const [reasoning, sampling] = view.models;
    expect(reasoning?.id).toBe("openai/gpt-5");
    expect(reasoning?.source).toBe("catalog");
    expect(reasoning?.paramProfile).toBe("reasoning");
    expect(reasoning?.reasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(reasoning?.pricing?.inputUsdPerMTok).toBe(2.5);
    expect(sampling?.source).toBe("provider");
    expect(sampling?.paramProfile).toBe("sampling");
    expect(sampling?.pricing).toBeNull();
  });

  it("uses apiKey and sends X-BaoBox-Tenant-Id header", async () => {
    const seen: { url?: string; auth?: string; tenant?: string } = {};
    const fetch = fakeFetch((url, init) => {
      seen.url = url;
      const headers = init.headers as Record<string, string>;
      seen.auth = headers.authorization;
      seen.tenant = headers["X-BaoBox-Tenant-Id"];
      return jsonResponse(200, {
        data: rawModelsView,
        metadata: { requestId: "r_mod2", latencyMs: 4 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      apiKey: "skb_tenant_key",
      fetch,
    });

    await bb.llmIntegrations.listModels("int_abc", { tenantId: "t_xyz" });

    expect(seen.url).toBe(
      "https://api.example.com/api/v1/llm-integrations/int_abc/models",
    );
    expect(seen.auth).toBe("Bearer skb_tenant_key");
    expect(seen.tenant).toBe("t_xyz");
  });

  it("URL-encodes integrationId in the path", async () => {
    const seen: { url?: string } = {};
    const fetch = fakeFetch((url) => {
      seen.url = url;
      return jsonResponse(200, {
        data: { ...rawModelsView, integrationId: "int_a/b" },
        metadata: { requestId: "r_mod3", latencyMs: 2 },
      });
    });
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    await bb.llmIntegrations.listModels("int_a/b");

    expect(seen.url).toBe(
      "https://api.example.com/api/v1/llm-integrations/int_a%2Fb/models",
    );
  });

  it("surfaces providerListError when the server returns one", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(200, {
        data: {
          integrationId: "int_abc",
          provider: "openai",
          models: [],
          providerListError: "upstream timeout",
        },
        metadata: { requestId: "r_mod4", latencyMs: 1 },
      }),
    );
    const bb = new BaoBoxClient({
      endpoint: "https://api.example.com",
      adminSecret: "adm",
      fetch,
    });

    const view = await bb.llmIntegrations.listModels("int_abc");

    expect(view.models).toHaveLength(0);
    expect(view.providerListError).toBe("upstream timeout");
  });
});
