import { getConfig } from "./shared/config.js";
import { getLogger } from "./shared/logger.js";
import { recoverOrphanedRuns } from "./modules/pipeline/crash-recovery.js";
import { PipelineScheduler } from "./modules/pipeline/scheduler.js";
import { PgListener } from "./modules/pipeline/pg-listener.js";

const logger = getLogger();

async function main(): Promise<void> {
  const config = getConfig();
  logger.info("Blindspot core process starting");

  // Paso 1: crash recovery antes de registrar LISTEN o cron
  const recovered = await recoverOrphanedRuns();
  if (recovered > 0) {
    logger.warn({ recovered }, "Recovered orphaned runs from previous crash");
  }

  const scheduler = new PipelineScheduler();

  // Paso 2: pg LISTEN para reacción inmediata a pg_notify
  if (config.DATABASE_URL) {
    const listener = new PgListener(config.DATABASE_URL, (runId) =>
      scheduler.handleNotify(runId)
    );
    await listener.start();

    process.on("SIGTERM", () => listener.stop());
    process.on("SIGINT", () => listener.stop());
  } else {
    logger.warn("DATABASE_URL not set — pg_notify LISTEN disabled; using polling fallback only");
  }

  // Paso 3: scheduler (polling + cron)
  await scheduler.start();

  process.on("SIGTERM", () => {
    logger.info("SIGTERM received — shutting down scheduler");
    scheduler.stop();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    logger.info("SIGINT received — shutting down scheduler");
    scheduler.stop();
    process.exit(0);
  });

  logger.info("Core process running — polling every 60s, pg_notify active");
}

main().catch((err) => {
  console.error("Fatal error in core process:", err);
  process.exit(1);
});
