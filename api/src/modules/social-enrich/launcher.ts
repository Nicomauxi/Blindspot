// Lanzador de social-enrich como subproceso CLI aislado (F2-ext Fase 3).
// El browser de Playwright NO debe correr dentro del proceso de la API (memoria/
// estabilidad): se spawnea el CLI detached — sobrevive reinicios de la API, que fue
// exactamente lo que mató el reproceso del 2026-06-09 — y loguea a logs/.
// El run queda visible en el Estado del run unificado porque el propio CLI crea un
// run kind "social" (createSocialEnrichRun) al arrancar.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

export interface SocialEnrichJobState {
  running: boolean;
  pid: number | null;
  started_at: string | null;
  log_file: string | null;
  limit: number | null;
  force: boolean | null;
}

interface CurrentJob {
  pid: number | null;
  started_at: string;
  log_file: string;
  limit: number;
  force: boolean;
}

// Single-flight por proceso de API: un solo subproceso de social-enrich a la vez.
// Limitación conocida: si la API se reinicia, pierde el registro del hijo (que sigue
// vivo por detached); el run "running" en la tabla runs mantiene la visibilidad.
let current: CurrentJob | null = null;

export function getSocialEnrichJobState(): SocialEnrichJobState {
  if (!current) {
    return { running: false, pid: null, started_at: null, log_file: null, limit: null, force: null };
  }
  return {
    running: true,
    pid: current.pid,
    started_at: current.started_at,
    log_file: current.log_file,
    limit: current.limit,
    force: current.force,
  };
}

export function launchSocialEnrichJob(opts: {
  limit: number;
  force: boolean;
  startedAtIso: string;
}): SocialEnrichJobState {
  if (current) {
    throw new Error("already_running");
  }

  const repoRoot = process.cwd();
  const logsDir = path.join(repoRoot, "logs");
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
  const logFile = path.join(logsDir, `social-enrich-${opts.startedAtIso.replace(/[:.]/g, "-")}.log`);
  const out = openSync(logFile, "a");

  const args = [
    "--env-file=.env",
    "--import",
    "tsx/esm",
    "src/cli/index.ts",
    "social-enrich",
    "--all",
    "--limit",
    String(opts.limit),
    ...(opts.force ? ["--force"] : []),
  ];

  // Sin LLM_PROVIDER (salvo que el operador lo haya seteado): regex-only, $0 Gemini.
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env },
  });
  child.unref();

  current = {
    pid: child.pid ?? null,
    started_at: opts.startedAtIso,
    log_file: logFile,
    limit: opts.limit,
    force: opts.force,
  };
  child.on("exit", () => {
    current = null;
  });
  child.on("error", () => {
    current = null;
  });

  return getSocialEnrichJobState();
}
