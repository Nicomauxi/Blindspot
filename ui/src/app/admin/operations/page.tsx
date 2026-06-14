"use client";

import { AdminPageLayout } from "@/components/admin-shell";
import { CollapsibleSection } from "@/components/collapsible-section";
import { PipelineSection } from "@/components/operations/pipeline-section";
import { MonitoringSection } from "@/components/operations/monitoring-section";
import { VariablesSection } from "@/components/operations/variables-section";
import { DiscoveryOps } from "@/components/operations/discovery-ops";

export default function OperationsPage() {
  return (
    <AdminPageLayout
      eyebrow="Operaciones"
      title="Operaciones"
      description="Hub único de operación: pipeline, generación de procesos, discovery, variables y monitoreo."
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

      {/* Generar Procesos + Discovery · contexto y mapa: salen de un único componente
          porque comparten estado (el mapa y las recomendaciones prefillean el composer). */}
      <DiscoveryOps />

      <CollapsibleSection
        title="Variables"
        description="Gobernanza de recursos del core: concurrencia, caps de CPU/RAM y velocidad de enrichment."
        id="variables"
        storageKey="ops-variables-open"
        defaultOpen={false}
      >
        <VariablesSection />
      </CollapsibleSection>

      <CollapsibleSection
        title="Monitoreo"
        description="Recursos de la PC, procesos del sistema, estado de runs, backups, costos y logs recientes."
        id="monitoring"
        storageKey="ops-monitoring-open"
        defaultOpen
      >
        <MonitoringSection />
      </CollapsibleSection>
    </AdminPageLayout>
  );
}
