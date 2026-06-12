import { createHmac } from "crypto";
import { fetch } from "undici";
import { getSupabase } from "../../shared/supabase.js";
import { getLogger } from "../../shared/logger.js";

export type WebhookEvent = "run_completed" | "new_hot_leads";

export interface WebhookConfig {
  url: string | null;
  secret: string | null;
  events: string[];
}

export type WebhookStatus = "not_configured" | "sent" | "failed";

function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export async function notifyWebhook(
  runId: string,
  event: WebhookEvent,
  config: WebhookConfig,
  payload: Record<string, unknown> = {}
): Promise<WebhookStatus> {
  const log = getLogger();

  if (!config.url || !config.events.includes(event)) {
    return "not_configured";
  }

  const body = JSON.stringify({
    event,
    run_id: runId,
    ts: new Date().toISOString(),
    ...payload,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Blindspot-Event": event,
    "X-Blindspot-Run-Id": runId,
  };

  if (config.secret) {
    headers["X-Blindspot-Signature"] = `sha256=${signPayload(config.secret, body)}`;
  }

  let status: WebhookStatus;
  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });
    status = res.ok ? "sent" : "failed";
    if (!res.ok) {
      log.warn({ runId, event, httpStatus: res.status }, "Webhook delivery failed (non-2xx)");
    } else {
      log.info({ runId, event }, "Webhook delivered");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ runId, event, err: msg }, "Webhook delivery error");
    status = "failed";
  }

  const db = getSupabase();
  // N115: el update se hacía sin chequear error — webhook_status podía quedar
  // desactualizado en silencio.
  const { error } = await db.from("pipeline_runs").update({ webhook_status: status }).eq("id", runId);
  if (error) {
    getLogger().warn({ runId, status, err: error.message }, "webhook_status update failed");
  }

  return status;
}

export async function loadWebhookConfig(): Promise<WebhookConfig> {
  const db = getSupabase();
  const { data } = await db
    .from("pipeline_config")
    .select("notify_webhook_url, notify_webhook_secret, notify_webhook_events")
    .eq("id", "singleton")
    .single();

  return {
    url: (data?.notify_webhook_url as string | null) ?? null,
    secret: (data?.notify_webhook_secret as string | null) ?? null,
    events: (data?.notify_webhook_events as string[] | null) ?? [],
  };
}
