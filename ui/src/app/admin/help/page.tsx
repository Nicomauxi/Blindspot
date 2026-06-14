import { HOT_LEAD_THRESHOLD } from "@/lib/hot-leads";
import Link from "next/link";
import { AdminPageLayout, HelpTip, SectionCard } from "@/components/admin-shell";

const modules = [
  {
    title: "Inicio",
    text: "Resume prioridades del día: volumen visible, hot leads y alertas que afectan la operación.",
  },
  {
    title: "Leads",
    text: "Es el espacio principal para entender, filtrar, priorizar y abrir oportunidades antes de contactar.",
  },
  {
    title: "CRM",
    text: "Concentra el seguimiento comercial vigente por etapas, owner y timeline de cada oportunidad.",
  },
  {
    title: "Operaciones · Discovery",
    text: "Dentro de Operaciones: controla cómo entran nuevos leads al sistema y cómo se preparan jobs, recomendaciones y refresh del inventario.",
  },
  {
    title: "Operaciones y Plataforma",
    text: "Agrupa pipeline, monitoreo, procesos, costos, calidad, usuarios, auditoría e importaciones. Es soporte operativo, no la entrada principal al trabajo comercial.",
  },
];

const glossary = [
  ["Prospect score", "Qué tan atractiva parece la oportunidad en una escala de 0 a 100 usando señales de valor, contacto y urgencia."],
  ["Tier de contacto", "Calidad esperada del contacto (≠ valor del lead). El valor comercial está en el prospect score y la brecha; el tier solo indica qué tan accionable es el contacto."],
  ["Contacto listo", "El lead tiene suficiente información de contacto útil para actuar sin investigación extra."],
  ["Urgencia", "Señal sintética de necesidad o dolor comercial. Sirve para ordenar el barrido, no como verdad absoluta."],
  ["Fuente canónica", "La fuente que el sistema toma como referencia principal cuando hay datos de múltiples orígenes."],
  ["Owner group", "Indica que varios leads pueden pertenecer al mismo dueño. Conviene evitar abordajes duplicados o incoherentes."],
  ["Pitch hook", "Motivo breve para personalizar una propuesta comercial. Ayuda a explicar por qué el lead merece una oferta específica."],
];

export default function HelpPage() {
  return (
    <AdminPageLayout
      eyebrow="Ayuda admin"
      title="Cómo usar Blindspot"
      description="Esta guía explica el flujo recomendado, qué resuelve cada módulo y cómo leer las métricas más importantes del panel."
      actions={
        <Link href="/admin/leads" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100">
          Ir a Leads
        </Link>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <SectionCard
          title="Flujo ideal de trabajo"
          description="Blindspot está pensado para descubrir, entender, priorizar y accionar leads sin perder trazabilidad."
        >
          <ol className="space-y-3 text-sm text-slate-600">
            <li><span className="font-medium text-slate-900">1. Captar:</span> usar Discovery o el pipeline para sumar y refrescar leads.</li>
            <li><span className="font-medium text-slate-900">2. Entender:</span> abrir Leads para ver score, tier, urgencia, owner group y estado inferido.</li>
            <li><span className="font-medium text-slate-900">3. Priorizar:</span> empezar por hot leads, tiers altos y casos con contacto listo.</li>
            <li><span className="font-medium text-slate-900">4. Accionar:</span> iniciar seguimiento, mover etapas y registrar notas/outcomes desde CRM.</li>
            <li><span className="font-medium text-slate-900">5. Corregir:</span> si baja la calidad de datos o falla la automatización, revisar Discovery, Operaciones o Plataforma según el caso.</li>
          </ol>
        </SectionCard>

        <SectionCard
          title="Atajos recomendados"
          description="Combinaciones simples para admins que recién entran al panel."
        >
          <div className="space-y-3 text-sm text-slate-600">
            <ShortcutRow href={`/admin/leads?prospect_score_gte=${HOT_LEAD_THRESHOLD}`} label="Hot leads" text="Priorizar oportunidades con score alto." />
            <ShortcutRow href="/admin/leads?contact_tier=A" label="Contacto A" text="Mejor calidad de contacto (no es ranking de valor)." />
            <ShortcutRow href="/admin/crm" label="CRM" text="Seguir etapas, notas, outcomes y ownership comercial." />
            <ShortcutRow href="/admin/operations" label="Operaciones · Discovery" text="Ver si están entrando leads nuevos o si hay jobs fallidos." />
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Qué hace cada módulo"
        description="Lenguaje breve, pensado para admins y no para desarrolladores."
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => (
            <div key={module.title} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-sm font-semibold text-slate-900">{module.title}</div>
              <p className="mt-2 text-sm text-slate-600">{module.text}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Cómo leer las señales"
        description="Usá estas definiciones como criterio operativo rápido."
      >
        <div className="space-y-4">
          {glossary.map(([term, description]) => (
            <div key={term} className="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <div className="pt-0.5"><HelpTip label={term}>{description}</HelpTip></div>
              <div>
                <p className="text-sm font-medium text-slate-900">{term}</p>
                <p className="mt-1 text-sm text-slate-600">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </AdminPageLayout>
  );
}

function ShortcutRow({ href, label, text }: { href: string; label: string; text: string }) {
  return (
    <Link href={href} className="block rounded-xl border border-slate-200 px-4 py-3 transition-colors hover:border-sky-200 hover:bg-sky-50/60">
      <div className="text-sm font-medium text-slate-900">{label}</div>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
    </Link>
  );
}
