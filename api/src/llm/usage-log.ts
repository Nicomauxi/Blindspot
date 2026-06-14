import type { FastifyBaseLogger } from "fastify";
import { createAlert } from "../../../src/storage/alerts.js";
import type { LlmUsageLog } from "./types.js";

// Cliente Supabase mínimo necesario para el insert (el `db` del route ya lo cumple).
interface UsageLogDb {
  from: (table: string) => { insert: (row: LlmUsageLog) => PromiseLike<{ error: { message: string } | null }> };
}

// D12: antes cada call-site insertaba en llm_usage_log con fire-and-forget y, si el
// insert fallaba, solo emitía un log.warn — el gasto LLM quedaba sin contabilizar y
// sin señal visible. Este helper centraliza el insert y escala un fallo a alerta
// (dedup por hora) para que el agujero de contabilidad NO sea silencioso.
export function recordLlmUsage(db: UsageLogDb, entry: LlmUsageLog, logger: FastifyBaseLogger): void {
  void Promise.resolve(db.from("llm_usage_log").insert(entry))
    .then(({ error }) => {
      if (!error) return;
      logger.warn({ error, operation: entry.operation }, "llm_usage_log insert failed");
      return createAlert({
        kind: "llm_usage_unlogged",
        severity: "warn",
        title: "Gasto LLM no contabilizado",
        description: `No se pudo registrar uso LLM (${entry.operation}, $${entry.cost_usd}): ${error.message}`,
        payload: { operation: entry.operation, cost_usd: entry.cost_usd, error: error.message },
        dedup_key: "llm_usage_unlogged",
        dedup_window_minutes: 60,
      }).catch((alertErr: unknown) =>
        logger.error({ alertErr }, "Failed to raise llm_usage_unlogged alert")
      );
    })
    .catch((err: unknown) => logger.warn({ err }, "llm_usage_log insert threw"));
}
