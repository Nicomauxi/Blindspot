import { getSupabase } from "../shared/supabase.js";

export type PipelineErrorPhase = "refresh" | "discovery" | "enrich" | "score" | "social-enrich";
export type PipelineErrorType =
  | "timeout"
  | "http_429"
  | "captcha"
  | "blocked"
  | "parse_failed"
  | "db_error"
  | "other";

export interface PipelineErrorRow {
  id: string;
  occurred_at: string;
  run_id: string | null;
  phase: PipelineErrorPhase;
  source: string | null;
  lead_id: string | null;
  error_type: PipelineErrorType;
  message: string;
  stack: string | null;
  recovered: boolean;
}

export interface RecordPipelineErrorInput {
  run_id?: string | null;
  phase: PipelineErrorPhase;
  source?: string | null;
  lead_id?: string | null;
  error_type: PipelineErrorType;
  message: string;
  stack?: string | null;
  recovered?: boolean;
}

export async function recordPipelineError(input: RecordPipelineErrorInput): Promise<PipelineErrorRow> {
  const payload = {
    run_id: input.run_id ?? null,
    phase: input.phase,
    source: input.source ?? null,
    lead_id: input.lead_id ?? null,
    error_type: input.error_type,
    message: input.message,
    stack: input.stack ?? null,
    recovered: input.recovered ?? false,
  };

  const { data, error } = await getSupabase().from("pipeline_errors").insert(payload).select().single();

  if (error) {
    throw new Error(`Failed to insert pipeline error: ${error.message}`);
  }

  return data as PipelineErrorRow;
}
