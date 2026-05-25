"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AdminSidebar } from "@/components/admin-shell";
import { useAuthStore } from "@/lib/auth-store";
import { isAdminRouteAllowed } from "@/lib/admin-access";
import { useTheme } from "@/components/theme-provider";

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
  const { theme, toggleTheme, hydrated: themeHydrated } = useTheme();

  // Garantía de hydration: si onRehydrateStorage no disparó (storage vacío, error de parsing,
  // primera visita desde este origen), forzamos hasHydrated=true después del mount.
  useEffect(() => {
    if (!useAuthStore.getState().hasHydrated) {
      useAuthStore.getState().setHydrated(true);
    }
  }, []);

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
      <main className="min-w-0 flex-1 overflow-auto p-6">
        <div className="mx-auto w-full max-w-[1440px]">{children}</div>
      </main>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={themeHydrated && theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        className="fixed bottom-6 right-6 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-white shadow-lg transition-colors hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        {themeHydrated && theme === "dark" ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        )}
      </button>
    </div>
  );
}
