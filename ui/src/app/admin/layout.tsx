"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AdminSidebar } from "@/components/admin-shell";
import { useAuthStore } from "@/lib/auth-store";
import { isAdminRouteAllowed } from "@/lib/admin-access";

function AccessDenied() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-700">Sin acceso</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Esta sección requiere permisos de administrador.</h1>
        <p className="mt-3 text-sm text-slate-600">
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
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 text-sm text-slate-500">
        Restableciendo sesión…
      </div>
    );
  }

  if (!token) return null;

  if (!isAdminRouteAllowed(pathname, role)) {
    return <AccessDenied />;
  }

  return (
    <div className="flex min-h-screen bg-slate-100">
      <AdminSidebar />
      <main className="min-w-0 flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
