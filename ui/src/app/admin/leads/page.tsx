"use client";

import { AdminPageLayout } from "@/components/admin-shell";
import { LeadExplorer } from "@/components/lead-explorer";

export default function LeadsPage() {
  return (
    <AdminPageLayout
      eyebrow="Leads"
      title="Lead Explorer"
      description="Usá esta vista como cola de trabajo: encontrá, entendé y abrí oportunidades sin perder el hilo comercial."
    >
      <LeadExplorer mode="full" />
    </AdminPageLayout>
  );
}
