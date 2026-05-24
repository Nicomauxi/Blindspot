"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type AuthState = {
  token: string | null;
  email: string | null;
  role: "admin" | "cm" | null;
  hasHydrated: boolean;
  setAuth: (token: string, email: string, role: "admin" | "cm") => void;
  clearAuth: () => void;
  setHydrated: (value: boolean) => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      email: null,
      role: null,
      hasHydrated: false,
      setAuth: (token, email, role) => set({ token, email, role }),
      clearAuth: () => set({ token: null, email: null, role: null }),
      setHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "blindspot-auth",
      // Solo persistir datos de sesión — hasHydrated es estado de runtime, no de sesión
      partialize: (state) => ({ token: state.token, email: state.email, role: state.role }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHydrated(true);
        } else {
          // state es undefined cuando la rehydration falla (storage corrupto, error de parsing, etc.)
          // Forzar hydrated para que la UI no quede bloqueada infinitamente
          useAuthStore.setState({ hasHydrated: true });
        }
      },
    }
  )
);
