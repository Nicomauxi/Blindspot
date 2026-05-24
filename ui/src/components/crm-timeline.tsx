"use client";

import type { LeadTrackingEvent } from "@/lib/api";
import { formatRelative } from "@/lib/utils";

function StatusPill({ status }: { status: string }) {
  const COLOR: Record<string, string> = {
    pending:    "bg-slate-100 text-slate-600",
    validation: "bg-amber-100 text-amber-700",
    contact:    "bg-sky-100 text-sky-700",
    observed:   "bg-violet-100 text-violet-700",
    rejected:   "bg-rose-100 text-rose-700",
    accepted:   "bg-emerald-100 text-emerald-700",
    note:       "bg-slate-100 text-slate-500 italic",
  };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${COLOR[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

function absoluteDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-UY", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function CrmTimeline({ events }: { events: LeadTrackingEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm theme-text-muted py-2">Sin eventos registrados aún.</p>;
  }

  const sorted = [...events].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <ol className="relative space-y-0 border-l-2 border-slate-200 pl-5">
      {sorted.map((ev, i) => {
        const isNote = ev.from_status === ev.to_status;
        return (
          <li key={ev.id} className={`relative pb-4 ${i === sorted.length - 1 ? "pb-0" : ""}`}>
            {/* dot */}
            <span
              className={`absolute -left-[1.5rem] top-1.5 flex h-3 w-3 items-center justify-center rounded-full border-2 border-white ${isNote ? "bg-slate-300" : "bg-sky-400"}`}
            />

            <div className="space-y-1">
              {/* header row */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {isNote ? (
                  <StatusPill status="note" />
                ) : (
                  <>
                    <StatusPill status={ev.from_status ?? "—"} />
                    <span className="text-slate-400">→</span>
                    <StatusPill status={ev.to_status} />
                  </>
                )}
                <span className="text-slate-400">·</span>
                <span
                  className="theme-text-muted"
                  title={absoluteDate(ev.created_at)}
                >
                  {formatRelative(ev.created_at)}
                </span>
                <span className="text-slate-400">·</span>
                <span className="theme-text-muted capitalize">{ev.actor_role}</span>
                <span className="text-[10px] text-slate-400">{ev.actor_user_id.slice(0, 8)}…</span>
              </div>

              {/* absolute date */}
              <p className="text-[10px] text-slate-400">{absoluteDate(ev.created_at)}</p>

              {/* channel */}
              {ev.channel && (
                <p className="text-xs theme-text-muted">
                  Canal: <span className="theme-text-strong">{ev.channel}</span>
                </p>
              )}

              {/* reminder */}
              {ev.reminder_at && (
                <p className="text-xs theme-text-muted">
                  Recordatorio: <span className="theme-text-strong">{absoluteDate(ev.reminder_at)}</span>
                </p>
              )}

              {/* notes */}
              {ev.notes && (
                <p className="text-xs theme-text-strong leading-snug">{ev.notes}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
