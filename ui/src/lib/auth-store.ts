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
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    }
  )
);
