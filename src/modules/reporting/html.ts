import Handlebars from "handlebars";
import type { Lead } from "../../shared/types.js";
import { buildLeadViews, bucketByProspect, sortLeadsForReport } from "./shared.js";
import type { RunMeta } from "./types.js";
import { DASHBOARD_TPL } from "./templates.js";

Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);

const compiledDashboard = Handlebars.compile(DASHBOARD_TPL);

const CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;background:#fff;color:#111;line-height:1.5;font-size:14px}
a{color:#1d4ed8;text-decoration:underline}
.container{max-width:1400px;margin:0 auto;padding:1.5rem 1rem}
h1{font-size:1.375rem;font-weight:700;margin-bottom:.25rem}
.run-meta{color:#555;font-size:.8125rem;margin-bottom:1.25rem}
code{background:#f1f5f9;padding:.0625rem .375rem;border-radius:3px;font-size:.8125rem}
.buckets{display:flex;flex-wrap:wrap;gap:.75rem;margin-bottom:1.25rem}
.bucket{border:1px solid #ddd;border-radius:4px;padding:.625rem 1rem;text-align:center;min-width:90px}
.bucket .cnt{display:block;font-size:1.5rem;font-weight:700}
.bucket .lbl{font-size:.6875rem;text-transform:uppercase;letter-spacing:.05em;color:#666}
.bucket.green{border-color:#16a34a}.bucket.green .cnt{color:#16a34a}
.bucket.yellow{border-color:#d97706}.bucket.yellow .cnt{color:#d97706}
.bucket.red{border-color:#dc2626}.bucket.red .cnt{color:#dc2626}
.bucket.gray{border-color:#9ca3af}.bucket.gray .cnt{color:#6b7280}
.search-bar{display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem}
.search-bar label{font-weight:500;font-size:.875rem}
.search-bar input{padding:.375rem .625rem;border:1px solid #d1d5db;border-radius:4px;font-size:.875rem;width:280px}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.8125rem}
thead th{background:#f8fafc;padding:.5rem .625rem;text-align:left;font-weight:600;white-space:nowrap;border-bottom:2px solid #e2e8f0;cursor:pointer;user-select:none}
thead th[data-sort]:hover{background:#f1f5f9}
thead th.sort-asc::after{content:" ↑";color:#2563eb}
thead th.sort-desc::after{content:" ↓";color:#2563eb}
tbody tr.data-row:nth-child(4n+1),tbody tr.data-row:nth-child(4n+2){background:#fafafa}
tbody tr.data-row:hover{background:#eff6ff}
td{padding:.4375rem .625rem;border-bottom:1px solid #f0f0f0;vertical-align:top}
.badge{display:inline-block;padding:.125rem .4375rem;border-radius:10px;font-size:.75rem;font-weight:600}
.badge-green{background:#dcfce7;color:#15803d}
.badge-yellow{background:#fef9c3;color:#92400e}
.badge-red{background:#fee2e2;color:#dc2626}
.dash{color:#9ca3af}
.tags{display:flex;flex-wrap:wrap;gap:.1875rem}
.tag{background:#f1f5f9;color:#475569;padding:.0625rem .3125rem;border-radius:3px;font-size:.6875rem;white-space:nowrap}
.detail-row td{padding:0}
.detail-panel{padding:.75rem 1rem;background:#f8fafc;border-left:3px solid #2563eb}
.detail-panel h4{font-size:.8125rem;font-weight:600;color:#1e40af;margin-bottom:.375rem;margin-top:.625rem}
.detail-panel h4:first-child{margin-top:0}
.rules{list-style:none}
.rules li{padding:.1875rem 0;font-size:.75rem;color:#334155}
.rules li .rn{font-weight:500}
.rules li .rv{font-family:ui-monospace,monospace;color:#555;font-size:.6875rem}
.fp-summary{font-size:.75rem;color:#555;margin-top:.5rem;font-style:italic}
.scoreless-warn{color:#92400e;font-weight:500;font-size:.75rem;margin-bottom:.375rem}
.btn-toggle{background:none;border:1px solid #2563eb;color:#2563eb;padding:.125rem .4375rem;border-radius:3px;cursor:pointer;font-size:.6875rem}
.btn-toggle:hover{background:#eff6ff}
.hidden{display:none!important}
@media(max-width:640px){.search-bar input{width:100%}.buckets{flex-direction:column}}`;

const JS = `(function(){
var tbody=document.getElementById('leads-tbody');
if(!tbody)return;
var dataRows=Array.from(tbody.querySelectorAll('tr.data-row'));
var sk='prospect',sd='desc';
function getV(row,key){
  var el=row.querySelector('[data-'+key+']');
  if(!el)return-Infinity;
  var v=el.getAttribute('data-'+key);
  if(v===''||v===null)return-Infinity;
  var n=Number(v);
  return isFinite(n)?n:v.toLowerCase();
}
function render(){
  var sorted=dataRows.slice().sort(function(a,b){
    var av=getV(a,sk),bv=getV(b,sk);
    if(av!==bv)return sd==='asc'?(av<bv?-1:1):(bv<av?-1:1);
    var an=getV(a,'name'),bn=getV(b,'name');
    return an<bn?-1:an>bn?1:0;
  });
  var frag=document.createDocumentFragment();
  sorted.forEach(function(r){
    frag.appendChild(r);
    var d=document.getElementById('detail-'+r.dataset.id);
    if(d)frag.appendChild(d);
  });
  tbody.appendChild(frag);
  document.querySelectorAll('thead th[data-sort]').forEach(function(h){
    h.classList.remove('sort-asc','sort-desc');
    if(h.dataset.sort===sk)h.classList.add('sort-'+sd);
  });
}
document.querySelectorAll('thead th[data-sort]').forEach(function(h){
  h.addEventListener('click',function(){
    if(h.dataset.sort===sk){sd=sd==='asc'?'desc':'asc';}
    else{sk=h.dataset.sort;sd='desc';}
    render();
  });
});
var si=document.getElementById('search');
if(si){si.addEventListener('input',function(){
  var q=si.value.toLowerCase();
  dataRows.forEach(function(r){
    var show=!q||(r.dataset.search||'').includes(q);
    r.style.display=show?'':'none';
    var d=document.getElementById('detail-'+r.dataset.id);
    if(d&&!show)d.classList.add('hidden');
  });
});}
document.querySelectorAll('.btn-toggle').forEach(function(btn){
  btn.addEventListener('click',function(){
    var p=document.getElementById(btn.dataset.target);
    if(!p)return;
    var h=p.classList.contains('hidden');
    p.classList.toggle('hidden');
    btn.textContent=h?'cerrar':'ver';
  });
});
render();
})();`;

export function generateHtml(leads: Lead[], runMeta: RunMeta): string {
  const sorted = sortLeadsForReport(leads);
  const leadViews = buildLeadViews(sorted);
  const buckets = bucketByProspect(sorted);

  const title = [runMeta.niche, runMeta.location].filter(Boolean).join(", ") || "Gap Radar";

  const context = {
    meta: {
      title: `Gap Radar — ${title}`,
      runId: runMeta.runId,
      niche: runMeta.niche ?? "",
      location: runMeta.location ?? "",
      generatedAt: runMeta.generatedAt,
      totalLeads: sorted.length,
    },
    buckets,
    leads: leadViews,
    cssBlock: CSS,
    jsBlock: JS,
  };

  return compiledDashboard(context);
}
