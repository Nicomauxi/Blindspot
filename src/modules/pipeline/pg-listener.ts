import pg from "pg";
import { getLogger } from "../../shared/logger.js";

const logger = getLogger();
const RECONNECT_DELAY_MS = 5_000;

export class PgListener {
  private client: pg.Client | null = null;
  private onNotify: (runId?: string) => Promise<void>;
  private stopped = false;
  private connectionString: string;

  constructor(connectionString: string, onNotify: (runId?: string) => Promise<void>) {
    this.connectionString = connectionString;
    this.onNotify = onNotify;
  }

  async start(): Promise<void> {
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.client?.end().catch(() => {});
    this.client = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    this.client = new pg.Client({ connectionString: this.connectionString });

    this.client.on("error", (err) => {
      logger.warn({ err }, "pg LISTEN connection error — will reconnect");
      this.scheduleReconnect();
    });

    this.client.on("end", () => {
      if (!this.stopped) {
        logger.warn("pg LISTEN connection ended — reconnecting");
        this.scheduleReconnect();
      }
    });

    try {
      await this.client.connect();
      await this.client.query("LISTEN pipeline_trigger");
      logger.info("pg LISTEN pipeline_trigger active");

      this.client.on("notification", (msg) => {
        const runId = msg.payload ?? undefined;
        logger.debug({ runId }, "pg_notify received");
        this.onNotify(runId).catch((err) =>
          logger.error({ err }, "Error handling pg_notify")
        );
      });
    } catch (err) {
      logger.warn({ err }, "Failed to connect for LISTEN — will retry");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.client = null;
    setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
  }
}
