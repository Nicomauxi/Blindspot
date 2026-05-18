import { getSupabase } from "../shared/supabase.js";

export async function getAdminServicePricing(serviceType: string): Promise<number | null> {
  const db = getSupabase();

  const { data, error } = await db
    .from("service_pricing")
    .select("monthly_fee, users!inner(role)")
    .eq("service_type", serviceType)
    .eq("users.role", "admin")
    .limit(1)
    .maybeSingle();

  if (error) return null;
  if (!data) return null;
  return (data as { monthly_fee: number }).monthly_fee;
}
