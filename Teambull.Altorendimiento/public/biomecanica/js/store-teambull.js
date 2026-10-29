// Puente con Team Bull: cuando Biomecánica se abre dentro de Team Bull, los alumnos son los de
// Team Bull y cada evaluación guardada se manda también a la ficha del alumno en Team Bull (que la
// sube a su nube). Acá queda la copia completa (con el video y los cuadros); en Team Bull, una
// versión compacta con los números, que es la que alimenta el informe y se ve desde otro celular.
import { localStore } from './store.js';

const ORIGIN = location.origin;
let alumnos = [];            // [{ id, nombre, bio: [evaluaciones compactas] }]
let listo = null, avisarListo = null;

export const inTeamBull = (() => { try { return window.self !== window.top; } catch { return true; } })();

function enviar(msg) { window.parent.postMessage({ tb: 'bio', ...msg }, ORIGIN); }

// Le pide a Team Bull el informe de biomecánica del alumno (hoja con gráficos y análisis para compartir)
export function pedirInforme(alumnoId) { enviar({ type: 'informe', alumnoId }); }

// Dirección y clave pública de la nube de Team Bull: solo para el canal en vivo con la tablet
let nube = null;
export const teambullNube = () => nube;

export function connectTeamBull() {
  if (listo) return listo;
  listo = new Promise((resolve) => { avisarListo = resolve; });
  window.addEventListener('message', (e) => {
    if (e.origin !== ORIGIN || e.source !== window.parent) return;
    const d = e.data;
    if (!d || d.tb !== 'bio' || d.type !== 'alumnos' || !Array.isArray(d.alumnos)) return;
    alumnos = d.alumnos;
    if (d.nube?.url && d.nube?.key) nube = d.nube;
    avisarListo();
    window.dispatchEvent(new CustomEvent('teambull-alumnos'));
  });
  enviar({ type: 'hola' });
  setTimeout(() => avisarListo(), 4000); // si Team Bull no contesta, se sigue con lo de este dispositivo
  return listo;
}

// Versión liviana de una evaluación para la nube de Team Bull: sin archivos, sin series largas.
const LIMITE = 20000;
function liviano(v, prof = 0) {
  if (Array.isArray(v)) return v.length > 120 ? undefined : v.map(x => liviano(x, prof + 1)).filter(x => x !== undefined);
  if (v && typeof v === 'object') {
    if (v instanceof Blob) return undefined;
    const o = {};
    for (const [k, x] of Object.entries(v)) { const y = liviano(x, prof + 1); if (y !== undefined) o[k] = y; }
    return o;
  }
  return v;
}
export function compacta(e) {
  const base = { id: e.id, athleteId: e.athleteId, kind: e.kind, date: e.date, title: e.title, event: e.event || '', summary: e.summary || {}, createdAt: e.createdAt, updatedAt: e.updatedAt };
  let data = liviano(e.data || {});
  if (JSON.stringify(data).length > LIMITE) {
    // solo lo que usa el informe: métricas, observaciones y el resumen de gym
    const d = e.data || {};
    data = liviano({ type: d.type, exercise: d.exercise, load: d.load, best: d.best, vl: d.vl, meanMv: d.meanMv, metrics: d.metrics, observations: d.observations, meta: d.meta && { style: d.meta.style, view: d.meta.view, event: d.meta.event, date: d.meta.date } });
  }
  return { ...base, data, compacta: true };
}

const porNombre = (a, b) => a.name.localeCompare(b.name, 'es');
// Ficha de Biomecánica a partir del alumno de Team Bull: el nombre siempre es el de Team Bull y,
// si acá no se cargó otra cosa, el club, la categoría y las pruebas salen de su ficha de Team Bull.
function conDatosTeamBull(a, local) {
  const l = local || {};
  return { ...l, id: a.id, name: a.nombre, club: l.club || a.equipo || '', category: l.category || a.nivel || a.deportes || '', events: l.events || a.pruebas || '', mass: a.peso || l.mass || null, height: a.altura || l.height || null, teambull: true };
}

export const teambullStore = {
  ...localStore,
  backend: 'local',
  teambull: true,
  async listAthletes() {
    await connectTeamBull();
    const locales = await localStore.listAthletes();
    return alumnos.map(a => conDatosTeamBull(a, locales.find(l => l.id === a.id))).sort(porNombre);
  },
  async getAthlete(id) {
    await connectTeamBull();
    const a = alumnos.find(x => x.id === id);
    if (!a) return null;
    return conDatosTeamBull(a, await localStore.getAthlete(id));
  },
  async saveAthlete(a) {
    await connectTeamBull();
    const tb = alumnos.find(x => x.id === a.id);
    if (!tb) throw new Error('Los alumnos se crean en Team Bull, en la pestaña Alumnos/as.');
    // los datos extra (club, categoría, pruebas, notas) quedan acá; el nombre es el de Team Bull
    const rec = await localStore.saveAthlete({ ...a, name: tb.nombre });
    return { ...rec, name: tb.nombre, teambull: true };
  },
  async deleteAthlete() { throw new Error('Para borrar un alumno, hacelo desde Team Bull.'); },
  async listEvaluations(athleteId) {
    await connectTeamBull();
    const locales = await localStore.listEvaluations(athleteId);
    const nube = (alumnos.find(a => a.id === athleteId)?.bio || []).filter(e => !locales.some(l => l.id === e.id));
    return [...locales, ...nube].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  },
  async getEvaluation(id) {
    const local = await localStore.getEvaluation(id);
    if (local) return local;
    for (const a of alumnos) { const e = (a.bio || []).find(x => x.id === id); if (e) return e; }
    return undefined;
  },
  async saveEvaluation(e) {
    const rec = await localStore.saveEvaluation.call(this, e);
    if (alumnos.some(a => a.id === rec.athleteId)) {
      const c = compacta(rec);
      alumnos = alumnos.map(a => (a.id === rec.athleteId ? { ...a, bio: [...(a.bio || []).filter(x => x.id !== c.id), c] } : a));
      enviar({ type: 'guardar', alumnoId: rec.athleteId, evaluacion: c });
    }
    return rec;
  },
  async deleteEvaluation(id) {
    const e = await this.getEvaluation(id);
    await localStore.deleteEvaluation(id);
    if (e?.athleteId) {
      alumnos = alumnos.map(a => (a.id === e.athleteId ? { ...a, bio: (a.bio || []).filter(x => x.id !== id) } : a));
      enviar({ type: 'borrar', alumnoId: e.athleteId, evaluacionId: id });
    }
  },
};
