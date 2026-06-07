"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { AlertsBell } from "@/components/alerts-bell";


type IconProps = {
  className?: string;
};

type IconComponent = (props: IconProps) => React.JSX.Element;

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: IconComponent;
  roles?: Array<"admin" | "cm">;
};

type NavGroup = {
  id: string;
  label: string;
  icon: IconComponent;
  items: NavItem[];
};

const SIDEBAR_GROUPS_STORAGE_KEY = "blindspot.adminSidebar.groups";

export const adminNavGroups: NavGroup[] = [
  {
    id: "operations",
    label: "Operación",
    icon: DashboardIcon,
    items: [
      {
        href: "/admin",
        label: "Inicio",
        description: "Prioridades, métricas y colas de trabajo",
        icon: DashboardIcon,
      },
      {
        href: "/admin/leads",
        label: "Leads",
        description: "Explorar, priorizar y entender oportunidades",
        icon: LeadsIcon,
      },
      {
        href: "/admin/discovery",
        label: "Discovery",
        description: "Jobs de discovery y entrada de nuevos leads",
        icon: DiscoveryIcon,
        roles: ["admin"],
      },
      {
        href: "/admin/operations",
        label: "Operaciones",
        description: "Pipeline, monitoreo y control del sistema",
        icon: PipelineIcon,
        roles: ["admin"],
      },
    ],
  },
  {
    id: "commercial",
    label: "Comercial",
    icon: OutreachIcon,
    items: [
      {
        href: "/admin/crm",
        label: "CRM",
        description: "Board de seguimiento por etapa",
        icon: CrmIcon,
      },
      {
        href: "/admin/segments",
        label: "Segmentos",
        description: "Atajos de exploración y volumen por corte",
        icon: SegmentsIcon,
      },
    ],
  },
  {
    id: "platform",
    label: "Plataforma",
    icon: PlatformIcon,
    items: [
      {
        href: "/admin/imports",
        label: "Importación",
        description: "Catálogo XLS de lugares y zonas para Discovery",
        icon: ImportIcon,
        roles: ["admin"],
      },
      {
        href: "/admin/backups",
        label: "Backups",
        description: "Dump manual, cron y retención operativa",
        icon: BackupIcon,
        roles: ["admin"],
      },

      {
        href: "/admin/costs",
        label: "Costos",
        description: "Uso de proveedores y costo por lead",
        icon: CostsIcon,
        roles: ["admin"],
      },
      {
        href: "/admin/performance",
        label: "Calidad",
        description: "Rendimiento, errores y cobertura de datos",
        icon: QualityIcon,
        roles: ["admin"],
      },
      {
        href: "/admin/users",
        label: "Usuarios",
        description: "Roles, filtros y acceso operativo",
        icon: UsersIcon,
        roles: ["admin"],
      },
      {
        href: "/admin/merge-candidates",
        label: "Unión de leads",
        description: "Revisar y confirmar uniones cross-source dudosas",
        icon: MergeIcon,
        roles: ["admin"],
      },
      {
        href: "/admin/audit-log",
        label: "Auditoría",
        description: "Cambios administrativos y trazabilidad",
        icon: AuditIcon,
        roles: ["admin"],
      },
    ],
  },
  {
    id: "help",
    label: "Ayuda",
    icon: HelpIcon,
    items: [
      {
        href: "/admin/help",
        label: "Ayuda",
        description: "Guía de uso, glosario y flujo recomendado",
        icon: HelpIcon,
      },
    ],
  },
];

function canAccess(roles: Array<"admin" | "cm"> | undefined, role: "admin" | "cm" | null) {
  if (!roles || roles.length === 0) return true;
  if (!role) return false;
  return roles.includes(role);
}

function isItemActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, email, role, clearAuth } = useAuthStore();

  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const isFirstMount = useRef(true);

  useEffect(() => {
    const nextState = adminNavGroups.reduce<Record<string, boolean>>((acc, group) => {
      acc[group.id] = group.items.some((item) => canAccess(item.roles, role) && isItemActive(pathname, item.href));
      return acc;
    }, {});

    // Restore sessionStorage only on initial mount; subsequent navigations auto-collapse non-active groups.
    if (isFirstMount.current) {
      isFirstMount.current = false;
      try {
        const stored = window.sessionStorage.getItem(SIDEBAR_GROUPS_STORAGE_KEY);
        const parsed = stored ? (JSON.parse(stored) as Record<string, boolean>) : {};
        for (const group of adminNavGroups) {
          nextState[group.id] = parsed[group.id] ?? nextState[group.id];
        }
      } catch {
        // Ignore invalid persisted state and fall back to route-based defaults.
      }
    }

    setExpandedGroups(nextState);
  }, [pathname, role]);

  useEffect(() => {
    if (!token || Object.keys(expandedGroups).length === 0) return;
    window.sessionStorage.setItem(SIDEBAR_GROUPS_STORAGE_KEY, JSON.stringify(expandedGroups));
  }, [expandedGroups, token]);

  if (!token) return null;

  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = adminNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!canAccess(item.roles, role)) return false;
        if (!normalizedQuery) return true;
        return `${item.label} ${item.description}`.toLowerCase().includes(normalizedQuery);
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="theme-sidebar flex w-72 shrink-0 flex-col border-r">
      <div className="px-5 py-5" style={{ borderBottom: "1px solid var(--sidebar-border)" }}>
        <Link href="/admin" className="block">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">
            Blindspot
          </div>
          <p className="mt-2 text-lg font-semibold text-white">Panel operativo</p>
        </Link>
        <p className="mt-3 truncate text-sm" style={{ color: "var(--sidebar-text)" }}>{email}</p>
        <p className="mt-1 text-xs uppercase tracking-wide" style={{ color: "var(--sidebar-soft)" }}>
          {role === "admin" ? "Administrador" : "Comercial"}
        </p>
      </div>

      <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--sidebar-border)" }}>
        <label className="block">
          <span className="sr-only">Buscar sección</span>
          <div className="flex items-center gap-2 rounded-xl border px-3 py-2 text-slate-300 focus-within:text-white" style={{ borderColor: "var(--sidebar-border)", backgroundColor: "rgba(15, 23, 42, 0.28)" }}>
            <SearchIcon className="size-4 shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar sección o acción"
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-500"
            />
          </div>
        </label>
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
        {visibleGroups.map((group) => {
          const hasActiveItem = group.items.some((item) => isItemActive(pathname, item.href));
          const isExpanded = normalizedQuery ? true : (expandedGroups[group.id] ?? hasActiveItem);

          return (
            <div key={group.id} className="rounded-2xl border" style={{ borderColor: "var(--sidebar-border)", backgroundColor: "rgba(15, 23, 42, 0.18)" }}>
              <button
                type="button"
                onClick={() =>
                  setExpandedGroups((current) => ({
                    ...current,
                    [group.id]: !(current[group.id] ?? hasActiveItem),
                  }))
                }
                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl border" style={{ borderColor: "var(--sidebar-border)", backgroundColor: "rgba(15, 23, 42, 0.32)", color: "var(--sidebar-text)" }}>
                    <group.icon className="size-4" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--sidebar-muted)" }}>
                      {group.label}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--sidebar-soft)" }}>
                      {group.items.length} opción{group.items.length === 1 ? "" : "es"}
                    </p>
                  </div>
                </div>
                <ChevronIcon className={cn("size-4 transition-transform", isExpanded && "rotate-180")} />
              </button>

              <div className={cn("space-y-1.5 overflow-hidden px-3 pb-3", !isExpanded && "hidden")}>
                {group.items.map((item) => {
                  const active = isItemActive(pathname, item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "block rounded-xl border px-3 py-3 transition-colors",
                        active ? "text-white" : "hover:bg-slate-900"
                      )}
                      style={
                        active
                          ? { borderColor: "var(--sidebar-accent-border)", backgroundColor: "var(--sidebar-accent)" }
                          : { borderColor: "transparent", color: "var(--sidebar-text)" }
                      }
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border"
                          style={
                            active
                              ? { borderColor: "var(--sidebar-accent-border)", backgroundColor: "rgba(14, 165, 233, 0.12)", color: "#e0f2fe" }
                              : { borderColor: "var(--sidebar-border)", backgroundColor: "rgba(15, 23, 42, 0.32)", color: "var(--sidebar-muted)" }
                          }
                        >
                          <item.icon className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{item.label}</div>
                          <p className="mt-1 text-xs" style={{ color: active ? "#d7efff" : "var(--sidebar-muted)" }}>
                            {item.description}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}

        {visibleGroups.length === 0 ? (
          <div className="rounded-xl border border-dashed px-3 py-4 text-sm" style={{ borderColor: "var(--sidebar-border)", color: "var(--sidebar-muted)" }}>
            No hay secciones que coincidan con la búsqueda actual.
          </div>
        ) : null}
      </nav>

      <div className="space-y-3 px-5 py-4" style={{ borderTop: "1px solid var(--sidebar-border)" }}>
        <button
          onClick={() => {
            clearAuth();
            router.replace("/login");
          }}
          className="text-left text-sm transition-colors hover:text-white"
          style={{ color: "var(--sidebar-muted)" }}
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}

function iconProps(className?: string) {
  return {
    className: cn("stroke-current", className),
    fill: "none",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  };
}

function DashboardIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M4 5h7v6H4z" />
      <path d="M13 5h7v4h-7z" />
      <path d="M13 11h7v8h-7z" />
      <path d="M4 13h7v6H4z" />
    </svg>
  );
}

function LeadsIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M7 18a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
      <path d="M17 7h3" />
      <path d="M14 12h6" />
      <path d="M14 17h4" />
    </svg>
  );
}

function DiscoveryIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

function PipelineIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M4 8h8v4H4z" />
      <path d="M12 10h3" />
      <path d="M15 6h5v8h-5z" />
      <path d="M8 12v4h8" />
    </svg>
  );
}

function OutreachIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M5 7h14v10H5z" />
      <path d="m6 8 6 5 6-5" />
    </svg>
  );
}

function SegmentsIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M4 12a8 8 0 1 0 16 0" />
      <path d="M12 4v8l5 3" />
    </svg>
  );
}

function CrmIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="10" y="3" width="5" height="5" rx="1" />
      <rect x="17" y="3" width="4" height="5" rx="1" />
      <path d="M5.5 8v3M12.5 8v3M19 8v3" />
      <rect x="3" y="13" width="5" height="8" rx="1" />
      <rect x="10" y="13" width="5" height="5" rx="1" />
    </svg>
  );
}

function PlatformIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M4 7h16" />
      <path d="M7 4v16" />
      <path d="M17 10v10" />
      <path d="M4 17h16" />
    </svg>
  );
}

function MergeIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M7 4v6a4 4 0 0 0 4 4h6" />
      <path d="M17 4v6a4 4 0 0 1-4 4H7" />
      <path d="M14 11l3 3-3 3" />
    </svg>
  );
}

function ImportIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M12 3v10" />
      <path d="m8 9 4 4 4-4" />
      <path d="M4 17v2h16v-2" />
    </svg>
  );
}

function BackupIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M5 7h14v10H5z" />
      <path d="M8 7V5h8v2" />
      <path d="M12 11v4" />
      <path d="m10 13 2 2 2-2" />
    </svg>
  );
}

function MonitoringIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M4 17h4l2-5 3 7 2-5h5" />
      <path d="M4 6h16" />
    </svg>
  );
}

function CostsIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M12 4v16" />
      <path d="M16 7.5c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.3 2.5 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3" />
    </svg>
  );
}

function QualityIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="m6 12 4 4 8-8" />
      <path d="M12 3 4 7v5c0 5 3.4 7.9 8 9 4.6-1.1 8-4 8-9V7z" />
    </svg>
  );
}

function UsersIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M17 13a2.5 2.5 0 1 0 0-5" />
      <path d="M4.5 19a5.5 5.5 0 0 1 9 0" />
      <path d="M15 18a4.5 4.5 0 0 1 5 0" />
    </svg>
  );
}

function AuditIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M7 4h10v16H7z" />
      <path d="M10 8h4" />
      <path d="M10 12h4" />
      <path d="M10 16h2" />
    </svg>
  );
}

function HelpIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.7c-.8.8-1.8 1.3-1.8 2.8" />
      <path d="M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function SearchIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ChevronIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

function SunIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
    </svg>
  );
}

export function AdminPageLayout({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <header className="theme-panel relative z-20 overflow-visible rounded-2xl px-6 py-5">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">{eyebrow}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h1 className="text-2xl font-semibold theme-text-strong">{title}</h1>
            {description ? <p className="mt-2 text-sm theme-text-muted">{description}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <AlertsBell />
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="theme-panel rounded-2xl">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] theme-text-strong">{title}</h2>
          {description ? <p className="mt-1 text-sm theme-text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "good" | "warn" | "info";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-4 shadow-sm backdrop-blur-sm",
        tone === "good" && "border-emerald-200 bg-emerald-50",
        tone === "warn" && "border-amber-200 bg-amber-50",
        tone === "info" && "border-sky-200 bg-sky-50",
        tone === "default" && "theme-panel"
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.15em] theme-text-soft">{label}</p>
      <div className="mt-3 text-2xl font-semibold theme-text-strong">{value}</div>
      {hint ? <p className="mt-2 text-sm theme-text-muted">{hint}</p> : null}
    </div>
  );
}

export function HelpTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors hover:border-sky-300 hover:text-sky-700"
        style={{ borderColor: "var(--border-strong)", backgroundColor: "var(--surface)", color: "var(--app-soft)" }}
      >
        ?
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-72 -translate-x-1/2 rounded-xl border px-3 py-2 text-left text-xs font-normal leading-5 shadow-xl group-hover:block group-focus-within:block"
        style={{ borderColor: "var(--sidebar-border)", backgroundColor: "var(--surface-stronger)", color: "var(--app-inverse)" }}
      >
        {children}
      </span>
    </span>
  );
}

export function EmptyPanel({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed px-6 py-10 text-center" style={{ borderColor: "var(--border-strong)", backgroundColor: "var(--surface-subtle)" }}>
      <p className="text-sm font-medium theme-text-strong">{title}</p>
      <p className="mt-2 text-sm theme-text-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
