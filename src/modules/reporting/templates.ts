// Inline templates as TS string constants — no asset bundling needed.

export const LEAD_TPL = `# {{{name}}}

**Prospect Score**: {{scores.prospect}}/100  ·  **BQ**: {{scores.bq}}  ·  **DG**: {{scores.dg}}  ·  **SG**: {{scores.sg}}

{{#if scoreless}}
> WARNING: Este lead no fue scoreado aún. Ejecutar: \`blindspot score --run <run_id>\`
{{/if}}

## Contacto
- Dirección: {{{address}}}
- Teléfono: {{{phone}}}
- WhatsApp: {{{whatsapp}}}
- Website: {{{website}}}
{{#if heuristicWeb}}- Web detectado: {{{heuristicWeb}}}
{{/if}}{{#if fbUrl}}- Facebook: {{{fbUrl}}}
{{/if}}{{#if igUrl}}- Instagram: {{{igUrl}}}
{{/if}}{{#if contactEmails}}- Email(s): {{{contactEmails}}}
{{/if}}- Google Maps: {{{googleMapsUrl}}}

## Por qué este score

{{#if breakdown}}
### Business Quality ({{scores.bq}}/100)
{{#each breakdown.bqRules}}
- **{{name}}** (+{{weight}}) — valor: \`{{matched_value}}\`
{{/each}}

### Digital Gap ({{scores.dg}}/100)
{{#each breakdown.dgRules}}
- **{{name}}** (+{{weight}}) — valor: \`{{matched_value}}\`
{{/each}}

### Systems Gap ({{scores.sg}}/100)
{{#each breakdown.sgRules}}
- **{{name}}** (+{{weight}}) — valor: \`{{matched_value}}\`
{{/each}}

{{else}}
_Sin desglose de score disponible._
{{/if}}

## Tags
{{tagsJoined}}

## Footprint digital
{{footprintSummary}}

## Notas
<!-- Nicolás escribe acá. Ejemplo: "Llamé el 12/05, atendió Beatriz, follow-up en 30 días." -->


---
_Generado automáticamente. Run: {{runId}}._
`;

export const DASHBOARD_TPL = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{meta.title}}</title>
<style>{{{cssBlock}}}</style>
</head>
<body>
<div class="container">
  <h1>{{meta.title}}</h1>
  <p class="run-meta">Generado {{meta.generatedAt}} &middot; Run: <code>{{meta.runId}}</code> &middot; {{meta.totalLeads}} leads</p>
  <div class="buckets">
    {{#each buckets}}
    <div class="bucket {{color}}">
      <span class="cnt">{{count}}</span>
      <span class="lbl">{{range}}</span>
    </div>
    {{/each}}
  </div>
  <div class="search-bar">
    <label for="search">Buscar:</label>
    <input type="search" id="search" placeholder="nombre, dirección, tag…">
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th data-sort="name">Nombre</th>
          <th data-sort="prospect">Prospect</th>
          <th data-sort="bq">BQ</th>
          <th data-sort="dg">DG</th>
          <th data-sort="sg">SG</th>
          <th>Tags</th>
          <th>Teléfono</th>
          <th>Dirección</th>
          <th>Links</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="leads-tbody">
        {{#each leads}}
        <tr class="data-row" data-id="{{rank}}" data-search="{{searchText}}">
          <td>{{rank}}</td>
          <td><span data-name="{{lead.name}}">{{lead.name}}</span></td>
          <td><span class="badge badge-{{color}}" data-prospect="{{prospectVal}}">{{prospectDisplay}}</span></td>
          <td><span data-bq="{{bqVal}}">{{bqDisplay}}</span></td>
          <td><span data-dg="{{dgVal}}">{{dgDisplay}}</span></td>
          <td><span data-sg="{{sgVal}}">{{sgDisplay}}</span></td>
          <td class="tags">{{#each displayTags}}<span class="tag">{{this}}</span>{{/each}}</td>
          <td>{{#if lead.phone}}<a href="tel:{{lead.phone}}">{{lead.phone}}</a>{{else}}<span class="dash">—</span>{{/if}}</td>
          <td>{{#if lead.address}}{{lead.address}}{{else}}<span class="dash">—</span>{{/if}}</td>
          <td>
            {{#if (safeUrl lead.website)}}<a href="{{safeUrl lead.website}}" target="_blank" rel="noopener noreferrer">web</a> &middot; {{/if}}<a href="{{mapsUrl}}" target="_blank" rel="noopener noreferrer">maps</a>
          </td>
          <td><button class="btn-toggle" data-target="detail-{{rank}}">ver</button></td>
        </tr>
        <tr id="detail-{{rank}}" class="detail-row hidden">
          <td colspan="11">
            <div class="detail-panel">
              {{#if scoreless}}<p class="scoreless-warn">Lead sin puntaje &mdash; ejecutar: blindspot score --run {{lead.first_seen_run_id}}</p>{{/if}}
              {{#if breakdown}}
              <h4>Business Quality ({{bqDisplay}}/100)</h4>
              <ul class="rules">
                {{#each breakdown.business_quality.rules}}
                <li><span class="rn">{{name}}</span> (+{{weight}}) &mdash; <span class="rv">{{matched_value}}</span></li>
                {{/each}}
              </ul>
              <h4>Digital Gap ({{dgDisplay}}/100)</h4>
              <ul class="rules">
                {{#each breakdown.digital_gap.rules}}
                <li><span class="rn">{{name}}</span> (+{{weight}}) &mdash; <span class="rv">{{matched_value}}</span></li>
                {{/each}}
              </ul>
              <h4>Systems Gap ({{sgDisplay}}/100)</h4>
              <ul class="rules">
                {{#each breakdown.systems_gap.rules}}
                <li><span class="rn">{{name}}</span> (+{{weight}}) &mdash; <span class="rv">{{matched_value}}</span></li>
                {{/each}}
              </ul>
              {{else}}
              <p><em>Sin desglose de score disponible.</em></p>
              {{/if}}
              <p class="fp-summary">{{footprintSummary}}</p>
            </div>
          </td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  </div>
</div>
<script>{{{jsBlock}}}</script>
</body>
</html>
`;
