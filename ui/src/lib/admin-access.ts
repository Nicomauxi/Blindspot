const ADMIN_ONLY_PREFIXES = [
  "/admin/discovery",
  "/admin/pipeline",
  "/admin/backups",
  "/admin/health",
  "/admin/costs",
  "/admin/performance",
  "/admin/users",
  "/admin/audit-log",
] as const;

export type AdminRole = "admin" | "cm" | null;

export function isAdminRouteAllowed(pathname: string, role: AdminRole): boolean {
  if (role === "admin") return true;
  if (!role) return false;
  return !ADMIN_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
