"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import styles from "./login.module.css";

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
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.hero}>
            <p className={styles.brand}>Blindspot</p>
            <h1 className={styles.heroTitle}>Panel operativo para descubrir, entender y accionar leads.</h1>
            <p className={styles.heroText}>
              Entrá al panel para priorizar oportunidades, registrar outreach y seguir la calidad del sistema sin perder contexto comercial.
            </p>
            <div className={styles.heroList}>
              <div className={styles.heroItem}>
                Inicio nuevo: prioridades comerciales, hot leads y alertas técnicas relevantes.
              </div>
              <div className={styles.heroItem}>
                Lead Explorer mejorado: filtros, contexto operativo y próximas acciones más claras.
              </div>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelInner}>
              <p className={styles.mobileBrand}>Blindspot</p>
              <h2 className={styles.title}>Ingresar</h2>
              <p className={styles.subtitle}>Usá tu cuenta admin o comercial para entrar al panel.</p>

              <form onSubmit={handleSubmit} className={styles.form}>
                <div className={styles.field}>
                  <label htmlFor="email" className={styles.label}>Email</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={styles.input}
                    required
                    autoComplete="email"
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="password" className={styles.label}>Contraseña</label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={styles.input}
                    required
                    autoComplete="current-password"
                  />
                </div>
                {error && <p className={styles.error}>{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className={styles.submit}
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
