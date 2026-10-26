// Ejercicios con retest: el entrenador arma su propia biblioteca de ejercicios (la app no trae ejercicios
// inventados), asigna uno al nadador apuntando a una medida de un análisis (la toma de control) y, cuando
// hay un análisis posterior del mismo estilo y toma, muestra el antes y el después con el criterio de
// cambio real. El retest vale si se filma igual: mismo lugar, misma toma y calidad parecida.
import { realChange } from './change.js';
import { shotCertificate } from './certificate.js';

// Medidas que se pueden seguir (las que guardan su error).
export const TRACKABLE = (id) => id.startsWith('ang_') || id.startsWith('fault_') || ['cycleRate', 'cycleTime', 'kickRate', 'speed', 'strokeLength'].includes(id);

// Medidas de una evaluación: las métricas y la medida de cada error técnico confirmado (para seguirlo con un ejercicio).
export const measuresOf = (e) => [...(e.data.metrics || []), ...(e.data.faults || []).filter(f => f.decision === 'confirmado' && Number.isFinite(f.value)).map(f => ({ id: 'fault_' + f.id, label: `Error: ${f.label.toLowerCase()}`, value: f.value, se: f.se, unit: f.unit, n: f.n }))];

const techOf = (evs) => evs.filter(e => e.kind === 'tech' && e.data?.meta && Array.isArray(e.data.metrics));
const metricOf = (e, id) => measuresOf(e).find(x => x.id === id && Number.isFinite(x.value)) || (id.startsWith('fault_') ? faultOf(e, id) : null);
// en el retest el error puede no estar confirmado: vale su medida igual
const faultOf = (e, id) => { const f = (e.data.faults || []).find(x => 'fault_' + x.id === id && Number.isFinite(x.value)); return f ? { id, label: f.label, value: f.value, se: f.se, unit: f.unit } : null; };
const order = (e) => `${e.date || ''} ${e.createdAt || ''}`;
const gradeOf = (e) => { try { return shotCertificate({ meta: e.data.meta, quality: e.data.quality || { groups: [], detectedFraction: 0 }, metrics: e.data.metrics }).grade; } catch { return null; } };

// Estado de un plan: { base, retest, before, after, change, verdict, warn, candidates }.
export function planStatus(plan, evs) {
  const tech = techOf(evs);
  const base = tech.find(e => e.id === plan.baseEvalId);
  if (!base) return { error: 'El análisis de control ya no está en la ficha.' };
  const bm = metricOf(base, plan.metricId);
  const candidates = tech.filter(e => e.id !== base.id && order(e) > order(base) && e.data.meta.style === base.data.meta.style && e.data.meta.view === base.data.meta.view && metricOf(e, plan.metricId))
    .sort((a, b) => order(b).localeCompare(order(a)));
  const retest = candidates.find(e => e.id === plan.retestEvalId) || candidates[0] || null;
  const out = { base, retest, candidates, before: bm ? { v: bm.value, se: bm.se, unit: bm.unit, label: bm.label } : null, warn: [] };
  if (!retest || !bm) return out;
  const am = metricOf(retest, plan.metricId);
  out.after = { v: am.value, se: am.se, unit: am.unit };
  out.change = realChange(out.before, out.after);
  const good = plan.goal === 'bajar' ? out.change.d < 0 : out.change.d > 0;
  out.verdict = out.change.verdict === 'real' ? (good ? 'mejoró' : 'empeoró') : out.change.verdict === 'ruido' ? 'sin cambio claro' : 'sin margen de error';
  const ga = gradeOf(base), gb = gradeOf(retest);
  if (ga === 'C' || gb === 'C') out.warn.push(`Calidad de toma: control ${ga || '?'}, retest ${gb || '?'}. Con grado C la comparación es solo orientativa.`);
  if ((base.data.meta.fileName || '') && base.data.meta.width !== retest.data.meta.width) out.warn.push('Las dos tomas tienen distinta resolución: revisá que se hayan filmado desde el mismo lugar.');
  return out;
}

export function newPlan({ drill, metricId, baseEvalId, goal, retestBy }) {
  return { id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), drillId: drill.id, drillName: drill.name, drillNote: drill.note || '', metricId, baseEvalId, goal, retestBy: retestBy || '', createdAt: new Date().toISOString() };
}
