"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AdminSidebar } from "@/components/admin-shell";
import { useAuthStore } from "@/lib/auth-store";
import { isAdminRouteAllowed } from "@/lib/admin-access";

function AccessDenied() {
  return (
    <div className="theme-page flex min-h-screen items-center justify-center px-6">
      <div className="theme-panel w-full max-w-lg rounded-2xl p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-700">Sin acceso</p>
        <h1 className="mt-3 text-2xl font-semibold theme-text-strong">Esta sección requiere permisos de administrador.</h1>
        <p className="mt-3 text-sm theme-text-muted">
          Tu sesión sigue activa, pero la ruta solicitada no está habilitada para tu rol actual.
        </p>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, role, hasHydrated } = useAuthStore();

  useEffect(() => {
    if (hasHydrated && !token) router.replace("/login");
  }, [hasHydrated, token, router]);

  if (!hasHydrated) {
    return (
      <div className="theme-page flex min-h-screen items-center justify-center px-6 text-sm theme-text-muted">
        Restableciendo sesión…
      </div>
    );
  }

  if (!token) return null;

  if (!isAdminRouteAllowed(pathname, role)) {
    return <AccessDenied />;
  }

  return (
    <div className="theme-page flex min-h-screen">
      <AdminSidebar />
      <main className="min-w-0 flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
