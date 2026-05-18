export type PipelineRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial' | 'aborted';
export type PipelineTriggeredBy = 'manual' | 'cron' | 'startup-recovery' | 'api';
export type CpuBudget = 'conservative' | 'balanced' | 'aggressive';

export interface PipelineRun {
  id: string;
  status: PipelineRunStatus;
  triggered_by: PipelineTriggeredBy;
  abort_requested: boolean;
  dashboard_stale: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  config_snapshot: PipelineConfig | null;
  overrides: PipelineOverrides | null;
  phase_results: PhaseResults | null;
  log_lines: LogLine[];
  invariant_details: Record<string, unknown> | null;
  webhook_status: 'not_configured' | 'sent' | 'failed';
}

export interface PipelineConfig {
  id: 'singleton';
  enabled: boolean;
  cron_expression: string;
  scheduled_for: string | null;
  last_completed_at: string | null;
  cpu_budget: CpuBudget;
  timeout_per_lead_sec: number;
  max_retries: number;
  phases: {
    refresh: { enabled: boolean; sources: string[]; priority_tiers_first: boolean };
    discovery: { enabled: boolean; max_jobs: number };
    enrich: { enabled: boolean; with_heuristic: boolean; concurrency: number };
    score: { enabled: boolean; recalculate_buyer_types: boolean };
  };
  google_places_budget_total: number;
  google_places_budget_spent: number;
  google_places_alert_threshold: number;
  notify_webhook_url: string | null;
  notify_webhook_secret: string | null;
  notify_webhook_events: string[];
}

export interface PipelineOverrides {
  dry_run?: boolean;
  phases?: string[];
  cpu_budget?: CpuBudget;
}

export interface PhaseResult {
  started_at: string;
  completed_at: string | null;
  status: 'ok' | 'skipped' | 'failed';
  items_processed?: number;
  error?: string;
}

export interface PhaseResults {
  refresh?: PhaseResult;
  discovery?: PhaseResult;
  enrich?: PhaseResult;
  score?: PhaseResult;
  invariant_check?: PhaseResult;
}

export interface LogLine {
  ts: string;
  msg: string;
  level: 'info' | 'warn' | 'error';
}

export interface DiscoveryJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  source: string;
  location: string;
  niche: string | null;
  triggered_by: 'manual' | 'scheduled' | 'gap_analysis';
}
