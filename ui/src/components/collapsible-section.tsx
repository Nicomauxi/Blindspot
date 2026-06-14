"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  title: string;
  description?: string;
  id?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  storageKey?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

function readStorage(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const stored = sessionStorage.getItem(key);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return fallback;
}

export function CollapsibleSection({
  title,
  description,
  id,
  defaultOpen = true,
  open: controlledOpen,
  onToggle,
  storageKey,
  actions,
  children,
}: CollapsibleSectionProps) {
  const isControlled = controlledOpen !== undefined;

  const [internalOpen, setInternalOpen] = useState(() => {
    if (storageKey) return readStorage(storageKey, defaultOpen);
    return defaultOpen;
  });

  const isOpen = isControlled ? controlledOpen : internalOpen;

  useEffect(() => {
    if (!id) return;
    if (window.location.hash === `#${id}`) {
      if (!isControlled) setInternalOpen(true);
      else onToggle?.(true);
    }
  }, [id, isControlled, onToggle]);

  function toggle() {
    const next = !isOpen;
    if (!isControlled) {
      setInternalOpen(next);
      if (storageKey) sessionStorage.setItem(storageKey, String(next));
    }
    onToggle?.(next);
  }

  return (
    <section id={id} className="theme-panel rounded-2xl overflow-hidden">
      {/* El header NO es un único <button>: `actions` puede traer botones propios y
          anidar <button> dentro de <button> es HTML inválido (error de hidratación). */}
      <div
        className="w-full flex items-start justify-between gap-3 px-5 py-4 hover:bg-slate-50 transition-colors"
        style={{ borderBottom: isOpen ? "1px solid var(--border)" : "none" }}
      >
        <button
          type="button"
          onClick={toggle}
          className="flex-1 min-w-0 text-left"
          aria-expanded={isOpen}
        >
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] theme-text-strong">{title}</h2>
          {description ? <p className="mt-1 text-sm theme-text-muted">{description}</p> : null}
        </button>
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          {actions}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isOpen}
            aria-label={isOpen ? "Colapsar sección" : "Expandir sección"}
            className="rounded-lg p-1 hover:bg-slate-100 transition-colors"
          >
            <svg
              className={cn("h-4 w-4 theme-text-muted transition-transform duration-200", isOpen ? "rotate-180" : "")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>
      {isOpen ? <div className="px-5 py-4 space-y-4">{children}</div> : null}
    </section>
  );
}
