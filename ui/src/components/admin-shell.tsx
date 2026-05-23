"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  description: string;
  roles?: Array<"admin" | "cm">;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

export const adminNavGroups: NavGroup[] = [
  {
    label: "Trabajo diario",
    items: [
      {
        href: "/admin",
        label: "Inicio",
        description: "Prioridades, métricas y colas de trabajo",
      },
      {
        href: "/admin/leads",
        label: "Leads",
        description: "Explorar, priorizar y entender oportunidades",
      },
      {
        href: "/admin/outreach",
        label: "Acciones",
        description: "Outreach, campañas y seguimiento comercial",
      },
    ],
  },
  {
    label: "Captación",
    items: [
      {
        href: "/admin/discovery",
        label: "Captación",
        description: "Jobs de discovery y entrada de nuevos leads",
        roles: ["admin"],
      },
      {
        href: "/admin/pipeline",
        label: "Automatizaciones",
        description: "Runs, cron y webhooks del pipeline",
        roles: ["admin"],
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        href: "/admin/help",
        label: "Ayuda",
        description: "Guía de uso, glosario y flujo recomendado",
      },
      {
        href: "/admin/segments",
        label: "Segmentos",
        description: "Atajos de exploración y volumen por corte",
      },
      {
        href: "/admin/backups",
        label: "Backups",
        description: "Dump manual, cron y retencion operativa",
        roles: ["admin"],
      },
      {
        href: "/admin/health",
        label: "Salud",
        description: "Estado operativo, presupuesto y procesos",
        roles: ["admin"],
      },
      {
        href: "/admin/costs",
        label: "Costos",
        description: "Uso de proveedores y costo por lead",
        roles: ["admin"],
      },
      {
        href: "/admin/performance",
        label: "Calidad",
        description: "Rendimiento, errores y cobertura de datos",
        roles: ["admin"],
      },
      {
        href: "/admin/users",
        label: "Usuarios",
        description: "Roles, filtros y acceso operativo",
        roles: ["admin"],
      },
      {
        href: "/admin/audit-log",
        label: "Auditoría",
        description: "Cambios administrativos y trazabilidad",
        roles: ["admin"],
      },
    ],
  },
];

function canAccess(roles: Array<"admin" | "cm"> | undefined, role: "admin" | "cm" | null) {
  if (!roles || roles.length === 0) return true;
  if (!role) return false;
  return roles.includes(role);
}

export function AdminSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, email, role, clearAuth } = useAuthStore();

  if (!token) return null;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 px-5 py-5">
        <Link href="/admin" className="block">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">
            Blindspot
          </div>
          <p className="mt-2 text-lg font-semibold text-white">Panel operativo</p>
        </Link>
        <p className="mt-3 truncate text-sm text-slate-300">{email}</p>
        <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
          {role === "admin" ? "Administrador" : "Comercial"}
        </p>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
        {adminNavGroups.map((group) => {
          const items = group.items.filter((item) => canAccess(item.roles, role));
          if (items.length === 0) return null;

          return (
            <div key={group.label}>
              <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                {group.label}
              </p>
              <div className="mt-2 space-y-1.5">
                {items.map((item) => {
                  const active =
                    item.href === "/admin"
                      ? pathname === "/admin"
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "block rounded-xl border px-3 py-3 transition-colors",
                        active
                          ? "border-sky-500/40 bg-sky-500/15 text-white"
                          : "border-transparent text-slate-300 hover:border-slate-800 hover:bg-slate-900"
                      )}
                    >
                      <div className="text-sm font-medium">{item.label}</div>
                      <p className={cn("mt-1 text-xs", active ? "text-sky-100/90" : "text-slate-500")}>
                        {item.description}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 px-5 py-4">
        <button
          onClick={() => {
            clearAuth();
            router.replace("/login");
          }}
          className="text-sm text-slate-400 transition-colors hover:text-white"
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
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
      <header className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">{eyebrow}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
            {description ? <p className="mt-2 text-sm text-slate-600">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
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
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-700">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
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
        "rounded-2xl border px-4 py-4 shadow-sm",
        tone === "good" && "border-emerald-200 bg-emerald-50",
        tone === "warn" && "border-amber-200 bg-amber-50",
        tone === "info" && "border-sky-200 bg-sky-50",
        tone === "default" && "border-slate-200 bg-white"
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</p>
      <div className="mt-3 text-2xl font-semibold text-slate-950">{value}</div>
      {hint ? <p className="mt-2 text-sm text-slate-600">{hint}</p> : null}
    </div>
  );
}

export function HelpTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-semibold text-slate-500 transition-colors hover:border-sky-300 hover:text-sky-700"
      >
        ?
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-72 -translate-x-1/2 rounded-xl border border-slate-200 bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-5 text-slate-100 shadow-xl group-hover:block group-focus-within:block">
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
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-800">{title}</p>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
