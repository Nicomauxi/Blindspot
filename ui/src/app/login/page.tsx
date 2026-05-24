"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { token, role } = await login(email, password);
      const payload = JSON.parse(atob(token.split(".")[1]!)) as {
        email: string;
      };
      setAuth(token, payload.email, role);
      router.replace("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#e0f2fe,_#f8fafc_45%,_#e2e8f0_100%)] px-4 py-10">
      <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[28px] border border-white/70 bg-white/85 shadow-2xl backdrop-blur xl:grid-cols-[1.1fr,0.9fr]">
          <div className="hidden border-r border-slate-200/80 bg-slate-950 px-10 py-12 text-white xl:block">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Blindspot</p>
            <h1 className="mt-6 text-4xl font-semibold leading-tight">Panel operativo para descubrir, entender y accionar leads.</h1>
            <p className="mt-5 max-w-md text-sm leading-6 text-slate-300">
              Entrá al panel para priorizar oportunidades, registrar outreach y seguir la calidad del sistema sin perder contexto comercial.
            </p>
            <div className="mt-10 space-y-4 text-sm text-slate-300">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4">
                Inicio nuevo: prioridades comerciales, hot leads y alertas técnicas relevantes.
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4">
                Lead Explorer mejorado: filtros, contexto operativo y próximas acciones más claras.
              </div>
            </div>
          </div>

          <div className="px-6 py-8 sm:px-10 sm:py-12">
            <div className="mx-auto max-w-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700 xl:hidden">Blindspot</p>
              <h2 className="mt-3 text-3xl font-semibold text-slate-950">Ingresar</h2>
              <p className="mt-2 text-sm text-slate-500">Usá tu cuenta admin o comercial para entrar al panel.</p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    required
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">Contraseña</label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    required
                    autoComplete="current-password"
                  />
                </div>
                {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-sky-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
                >
                  {loading ? "Ingresando…" : "Ingresar"}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
