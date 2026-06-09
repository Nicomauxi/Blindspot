"use client";

import { useCallback, useEffect, useState } from "react";
import { getAdminVariables, patchAdminVariable, type VariableItem } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

const WEBHOOK_EVENT_OPTIONS = ["run_completed", "new_hot_leads"] as const;

function displayValue(item: VariableItem): string {
  if (item.value === null || item.value === undefined) return item.sensitive ? "—" : "—";
  if (item.sensitive && typeof item.value === "string") return "•••••••••";
  if (Array.isArray(item.value)) return item.value.length > 0 ? item.value.join(", ") : "—";
  if (typeof item.value === "boolean") return item.value ? "Sí" : "No";
  return String(item.value);
}

type EditState = {
  key: string;
  draft: string | boolean | string[];
  saving: boolean;
  error: string | null;
};

function BoolEditor({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={cn(
          "rounded-lg px-3 py-1.5 text-xs font-medium",
          value ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
        )}
      >
        Sí
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={cn(
          "rounded-lg px-3 py-1.5 text-xs font-medium",
          !value ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
        )}
      >
        No
      </button>
    </div>
  );
}

function ArrayEditor({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: readonly string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (opt: string) => {
    const next = value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt];
    onChange(next);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <label key={opt} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={value.includes(opt)}
            onChange={() => toggle(opt)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          {opt}
        </label>
      ))}
    </div>
  );
}

function VariableRow({
  item,
  onSaved,
}: {
  item: VariableItem;
  onSaved: (updated: VariableItem[]) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [edit, setEdit] = useState<EditState | null>(null);

  const startEdit = () => {
    let draft: string | boolean | string[];
    if (item.type === "boolean") draft = typeof item.value === "boolean" ? item.value : false;
    else if (item.type === "string_array") draft = Array.isArray(item.value) ? item.value : [];
    else draft = item.sensitive ? "" : (item.value != null ? String(item.value) : "");
    setEdit({ key: item.key, draft, saving: false, error: null });
  };

  const cancel = () => setEdit(null);

  const save = useCallback(async () => {
    if (!token || !edit) return;
    setEdit((e) => e && { ...e, saving: true, error: null });
    try {
      let value: boolean | number | string | string[] | null;
      if (item.type === "boolean") {
        value = edit.draft as boolean;
      } else if (item.type === "number") {
        const n = Number(edit.draft);
        if (Number.isNaN(n)) throw new Error("Debe ser un número válido.");
        value = n;
      } else if (item.type === "string_array") {
        value = edit.draft as string[];
      } else {
        value = (edit.draft as string).trim() || null;
      }
      const res = await patchAdminVariable(token, item.key, value);
      onSaved(res.data);
      setEdit(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al guardar.";
      setEdit((e) => e && { ...e, saving: false, error: msg });
    }
  }, [token, edit, item.key, item.type, onSaved]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">{item.label}</span>
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{item.key}</code>
            {item.sensitive && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                sensible
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
        </div>

        {!edit && (
          <button
            type="button"
            onClick={startEdit}
            className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Editar
          </button>
        )}
      </div>

      {!edit ? (
        <div className="mt-2 text-sm font-mono text-slate-700">{displayValue(item)}</div>
      ) : (
        <div className="mt-3 space-y-2">
          {item.type === "boolean" && (
            <BoolEditor
              value={edit.draft as boolean}
              onChange={(v) => setEdit((e) => e && { ...e, draft: v })}
            />
          )}
          {item.type === "string_array" && (
            <ArrayEditor
              value={edit.draft as string[]}
              options={WEBHOOK_EVENT_OPTIONS}
              onChange={(v) => setEdit((e) => e && { ...e, draft: v })}
            />
          )}
          {(item.type === "string" || item.type === "number") && (
            <input
              type={item.type === "number" ? "number" : "text"}
              value={edit.draft as string}
              onChange={(e) => setEdit((s) => s && { ...s, draft: e.target.value })}
              placeholder={item.sensitive ? "Nuevo valor (dejar vacío para borrar)" : ""}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          )}

          {edit.error && (
            <p className="text-xs text-rose-600">{edit.error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={edit.saving}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {edit.saving ? "Guardando…" : "Guardar"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={edit.saving}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function VariablesSection() {
  const token = useAuthStore((s) => s.token);
  const [items, setItems] = useState<VariableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    getAdminVariables(token)
      .then((res) => setItems(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : "Error al cargar variables."))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSaved = useCallback((updated: VariableItem[]) => {
    setItems(updated);
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-500">Cargando variables…</p>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  // Las variables de grupo "pipeline" (cron, budget GP, webhooks, max_jobs) se editan en la
  // sección Pipeline: acá sólo se lista la gobernanza de recursos para no duplicar edición.
  const resourceItems = items.filter((item) => item.group !== "pipeline");

  return (
    <div className="space-y-3">
      <p className="text-sm theme-text-muted">
        Gobernanza de recursos del core. Los cambios se persisten inmediatamente y quedan registrados en el audit log.
        Cron, budget de Google Places y webhooks se editan en la sección <strong>Pipeline</strong>.
      </p>
      {resourceItems.map((item) => (
        <VariableRow key={item.key} item={item} onSaved={handleSaved} />
      ))}
    </div>
  );
}
