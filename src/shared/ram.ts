import { freemem } from "os";
import type { CpuBudget } from "../modules/pipeline/types.js";

export const CHROMIUM_MB_PER_INSTANCE = 200;
export const MAX_INSTANCES_CONSERVATIVE = 8;
export const MAX_INSTANCES_AUTO = 16;

export const DISCOVERY_JOB_CONCURRENCY: Record<CpuBudget, number> = {
  conservative: 1,
  balanced: 2,
  aggressive: 4,
};

export const DISCOVERY_JOB_RAM_PCT: Record<CpuBudget, number> = {
  conservative: 15,
  balanced: 35,
  aggressive: 65,
};

export function discoveryJobConcurrencyFromCpuBudget(budget: CpuBudget): number {
  return DISCOVERY_JOB_CONCURRENCY[budget];
}

export type RamMode = "conservative" | "auto" | "manual";

export interface RamConfig {
  mode: RamMode;
  concurrency: number;
  freeRamMb: number;
  maxAllowedMb: number;
}

export function computeConcurrency(
  mode: RamMode,
  manualConcurrency?: number
): RamConfig {
  const freeRamMb = freemem() / 1024 / 1024;

  if (mode === "manual") {
    const requested = manualConcurrency ?? 1;
    const maxAllowedMb = freeRamMb * 0.8;
    const estimatedMb = requested * CHROMIUM_MB_PER_INSTANCE;
    if (estimatedMb > freeRamMb * 0.95) {
      throw new Error(
        `--concurrency ${requested} would use ~${Math.round(estimatedMb)}MB ` +
          `but only ${Math.round(freeRamMb)}MB RAM is free. ` +
          `Reduce --concurrency or use --ram-mode auto.`
      );
    }
    return { mode, concurrency: requested, freeRamMb, maxAllowedMb };
  }

  const ratio = mode === "auto" ? 0.8 : 0.4;
  const cap =
    mode === "auto" ? MAX_INSTANCES_AUTO : MAX_INSTANCES_CONSERVATIVE;
  const maxAllowedMb = freeRamMb * ratio;
  const concurrency = Math.max(
    1,
    Math.min(
      Math.floor(maxAllowedMb / CHROMIUM_MB_PER_INSTANCE),
      cap
    )
  );

  return { mode, concurrency, freeRamMb, maxAllowedMb };
}
