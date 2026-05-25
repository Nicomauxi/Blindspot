"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listAuditLog,
  listUsers,
  type AuditLogEntry,
  type User,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn, formatDate } from "@/lib/utils";

export default function AuditLogPage() {
  const token = useAuthStore((s) => s.token);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [diffEntry, setDiffEntry] = useState<AuditLogEntry | null>(null);

  const [actorId, setActorId] = useState("");
  const [action, setAction] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    if (!token) return;
    listUsers(token, undefined, 50)
      .then((res) => setUsers(res.data))
      .catch(() => {});
  }, [token]);

  const load = useCallback(
    async (cursor?: string) => {
      if (!token) return;
      setLoading(true);
      try {
        const res = await listAuditLog(token, {
          actor: actorId || undefined,
          action: action || undefined,
          from: fromDate ? `${fromDate}T00:00:00.000Z` : undefined,
          to: toDate ? `${toDate}T23:59:59.999Z` : undefined,
          cursor,
          limit: 50,
        });
        if (cursor) {
          setEntries((prev) => [...prev, ...res.data]);
        } else {
          setEntries(res.data);
        }
        setTotal(res.total);
        setNextCursor(res.next_cursor);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar audit log");
      } finally {
        setLoading(false);
      }
    },
    [token, actorId, action, fromDate, toDate]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const userMap = useMemo(
    () => new Map(users.map((u) => [u.id, u.email])),
    [users]
  );

  function exportJson() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          Historial de acciones{" "}
          <span className="text-gray-400 text-base font-normal">({total})</span>
        </h1>
        <button
          onClick={exportJson}
          className="text-sm text-brand-600 hover:underline font-medium"
        >
          Exportar JSON
        </button>
      </div>

      <FilterBar
        users={users}
        actorId={actorId}
        action={action}
        fromDate={fromDate}
        toDate={toDate}
        onActorChange={setActorId}
        onActionChange={setAction}
        onFromChange={setFromDate}
        onToChange={setToDate}
      />

      {error && (
        <div className="bg-red-50 text-red-700 rounded px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Fecha/hora</th>
              <th className="px-4 py-3 text-left">Actor</th>
              <th className="px-4 py-3 text-left">Acción</th>
              <th className="px-4 py-3 text-left">Target</th>
              <th className="px-4 py-3 text-left">Diff</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.map((entry) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                userMap={userMap}
                onViewDiff={() => setDiffEntry(entry)}
              />
            ))}
            {entries.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Sin registros
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        {nextCursor && (
          <div className="px-4 py-3 border-t text-center">
            <button
              onClick={() => void load(nextCursor)}
              disabled={loading}
              className="text-sm text-brand-600 hover:underline disabled:opacity-50"
            >
              {loading ? "Cargando…" : "Cargar más"}
            </button>
          </div>
        )}
      </div>

      {diffEntry && (
        <DiffModal entry={diffEntry} onClose={() => setDiffEntry(null)} />
      )}
    </div>
  );
}

function FilterBar({
  users,
  actorId,
  action,
  fromDate,
  toDate,
  onActorChange,
  onActionChange,
  onFromChange,
  onToChange,
}: {
  users: User[];
  actorId: string;
  action: string;
  fromDate: string;
  toDate: string;
  onActorChange: (v: string) => void;
  onActionChange: (v: string) => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 flex flex-wrap gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500 font-medium">Actor</label>
        <select
          value={actorId}
          onChange={(e) => onActorChange(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1.5 min-w-[160px]"
        >
          <option value="">Todos</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500 font-medium">Acción</label>
        <input
          type="text"
          value={action}
          onChange={(e) => onActionChange(e.target.value)}
          placeholder="ej. user.create"
          className="text-sm border border-gray-300 rounded px-2 py-1.5 min-w-[160px]"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500 font-medium">Desde</label>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => onFromChange(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1.5"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500 font-medium">Hasta</label>
        <input
          type="date"
          value={toDate}
          onChange={(e) => onToChange(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1.5"
        />
      </div>
    </div>
  );
}

function AuditRow({
  entry,
  userMap,
  onViewDiff,
}: {
  entry: AuditLogEntry;
  userMap: Map<string, string>;
  onViewDiff: () => void;
}) {
  const actorEmail =
    userMap.get(entry.actor_user_id) ??
    entry.actor_user_id.slice(0, 8) + "…";

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap font-mono">
        {formatDate(entry.occurred_at)}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs font-medium">{actorEmail}</span>
        <span
          className={cn(
            "ml-2 px-1.5 py-0.5 rounded text-xs",
            entry.actor_role === "admin"
              ? "bg-purple-100 text-purple-700"
              : "bg-blue-100 text-blue-700"
          )}
        >
          {entry.actor_role}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="font-mono text-xs bg-gray-100 rounded px-1.5 py-0.5">
          {entry.action}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-gray-500">
        {entry.target_type && (
          <>
            {entry.target_type}
            {entry.target_id && (
              <span className="ml-1 font-mono opacity-60">
                {entry.target_id.length > 12
                  ? entry.target_id.slice(0, 8) + "…"
                  : entry.target_id}
              </span>
            )}
          </>
        )}
      </td>
      <td className="px-4 py-3">
        {entry.diff && (
          <button
            onClick={onViewDiff}
            className="text-xs text-brand-600 hover:underline"
          >
            Ver diff
          </button>
        )}
      </td>
    </tr>
  );
}

function DiffModal({
  entry,
  onClose,
}: {
  entry: AuditLogEntry;
  onClose: () => void;
}) {
  const diffObj = entry.diff ?? {};
  const hasSides =
    Object.prototype.hasOwnProperty.call(diffObj, "before") ||
    Object.prototype.hasOwnProperty.call(diffObj, "after");

  const before = hasSides
    ? (diffObj.before as Record<string, unknown> | null) ?? {}
    : null;
  const after = hasSides
    ? (diffObj.after as Record<string, unknown> | null) ?? {}
    : null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">
              Diff — {entry.action}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {formatDate(entry.occurred_at)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>
        <div className="overflow-auto flex-1 px-6 py-4">
          {hasSides ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                  Antes
                </p>
                <pre className="text-xs bg-red-50 rounded p-3 overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(before, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                  Después
                </p>
                <pre className="text-xs bg-green-50 rounded p-3 overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(after, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <pre className="text-xs bg-gray-50 rounded p-3 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(entry.diff, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
