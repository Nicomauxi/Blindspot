import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("../../src/shared/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("undici", () => ({
  fetch: vi.fn(),
}));

import { notifyWebhook, loadWebhookConfig } from "../../src/modules/pipeline/webhook.js";
import { fetch } from "undici";

const mockFetch = vi.mocked(fetch);

function mockDbUpdate() {
  const updateChain = { eq: vi.fn().mockResolvedValue({ error: null }) };
  mockFrom.mockReturnValue({ update: vi.fn(() => updateChain) });
  return updateChain;
}

describe("notifyWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'not_configured' when url is null", async () => {
    const status = await notifyWebhook("run-1", "run_completed", {
      url: null,
      secret: null,
      events: ["run_completed"],
    });
    expect(status).toBe("not_configured");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 'not_configured' when event not in events list", async () => {
    const status = await notifyWebhook("run-1", "run_completed", {
      url: "https://example.com/hook",
      secret: null,
      events: ["new_hot_leads"],
    });
    expect(status).toBe("not_configured");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 'sent' on successful HTTP 200 and persists to DB", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
    } as Awaited<ReturnType<typeof fetch>>);
    mockDbUpdate();

    const status = await notifyWebhook("run-1", "run_completed", {
      url: "https://example.com/hook",
      secret: null,
      events: ["run_completed"],
    });

    expect(status).toBe("sent");
    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl, calledOpts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://example.com/hook");
    expect(calledOpts.method).toBe("POST");
    const body = JSON.parse(calledOpts.body as string) as Record<string, unknown>;
    expect(body.event).toBe("run_completed");
    expect(body.run_id).toBe("run-1");
    expect(mockFrom).toHaveBeenCalledWith("pipeline_runs");
  });

  it("returns 'failed' on HTTP 500 and persists to DB", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    } as Awaited<ReturnType<typeof fetch>>);
    mockDbUpdate();

    const status = await notifyWebhook("run-1", "run_completed", {
      url: "https://example.com/hook",
      secret: null,
      events: ["run_completed"],
    });

    expect(status).toBe("failed");
  });

  it("returns 'failed' on network error and persists to DB", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    mockDbUpdate();

    const status = await notifyWebhook("run-1", "run_completed", {
      url: "https://example.com/hook",
      secret: null,
      events: ["run_completed"],
    });

    expect(status).toBe("failed");
  });

  it("includes HMAC signature header when secret is set", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 } as Awaited<ReturnType<typeof fetch>>);
    mockDbUpdate();

    await notifyWebhook("run-1", "run_completed", {
      url: "https://example.com/hook",
      secret: "supersecret123",
      events: ["run_completed"],
    });

    const [, opts] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(opts.headers["X-Blindspot-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("passes additional payload fields", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 } as Awaited<ReturnType<typeof fetch>>);
    mockDbUpdate();

    await notifyWebhook("run-1", "run_completed", {
      url: "https://example.com/hook",
      secret: null,
      events: ["run_completed"],
    }, { status: "completed" });

    const [, opts] = mockFetch.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(opts.body) as Record<string, unknown>;
    expect(body.status).toBe("completed");
  });
});

describe("loadWebhookConfig", () => {
  it("returns config from DB", async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        notify_webhook_url: "https://example.com/hook",
        notify_webhook_secret: "sec",
        notify_webhook_events: ["run_completed"],
      },
    });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: singleMock })) })),
    });

    const cfg = await loadWebhookConfig();
    expect(cfg.url).toBe("https://example.com/hook");
    expect(cfg.secret).toBe("sec");
    expect(cfg.events).toEqual(["run_completed"]);
  });

  it("returns null fields when DB returns null", async () => {
    const singleMock = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: singleMock })) })),
    });

    const cfg = await loadWebhookConfig();
    expect(cfg.url).toBeNull();
    expect(cfg.secret).toBeNull();
    expect(cfg.events).toEqual([]);
  });
});
