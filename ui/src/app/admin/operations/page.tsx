"use client";

import { AdminPageLayout } from "@/components/admin-shell";
import { CollapsibleSection } from "@/components/collapsible-section";
import { PipelineSection } from "@/components/operations/pipeline-section";
import { MonitoringSection } from "@/components/operations/monitoring-section";

export default function OperationsPage() {
  return (
    <AdminPageLayout
      eyebrow="Operaciones"
      title="Operaciones"
      description="Pipeline y monitoreo del sistema en una sola pantalla. Expandí o colapsá cada sección según lo que necesitás ver."
    >
      <CollapsibleSection
        title="Pipeline"
        description="Configuración del cron, ejecución manual, budget GP y webhooks."
        id="pipeline"
        storageKey="ops-pipeline-open"
        defaultOpen
      >
        <PipelineSection />
      </CollapsibleSection>

      <CollapsibleSection
        title="Monitoreo"
        description="Estado operativo del sistema: procesos, runs, backups, costos y logs recientes."
        id="monitoring"
        storageKey="ops-monitoring-open"
        defaultOpen
      >
        <MonitoringSection />
      </CollapsibleSection>
    </AdminPageLayout>
  );
}
