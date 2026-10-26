// Almacenamiento de alumnos y evaluaciones.
// Interfaz asíncrona pensada para cambiar de backend sin tocar la interfaz de usuario:
// hoy usa IndexedDB (solo en este dispositivo); la versión con cuentas usará una base de datos en la nube.

const DB = 'swimlab', VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB, VER); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('athletes')) db.createObjectStore('athletes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('evaluations')) {
        const s = db.createObjectStore('evaluations', { keyPath: 'id' });
        s.createIndex('athleteId', 'athleteId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('No se pudo abrir el almacenamiento local.'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(r => { out = r; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Operación cancelada.'));
  }));
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const localStore = {
  backend: 'local',
  async available() { try { await open(); return true; } catch { return false; } },
  async listAthletes() {
    const all = await tx('athletes', 'readonly', s => req(s.getAll()));
    return all.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  },
  async getAthlete(id) { return tx('athletes', 'readonly', s => req(s.get(id))); },
  async saveAthlete(a) {
    const now = new Date().toISOString();
    const rec = { createdAt: now, ...a, id: a.id || newId(), updatedAt: now };
    await tx('athletes', 'readwrite', s => req(s.put(rec)));
    return rec;
  },
  async deleteAthlete(id) {
    const evs = await this.listEvaluations(id);
    await tx('evaluations', 'readwrite', s => Promise.all(evs.map(e => req(s.delete(e.id)))));
    await tx('athletes', 'readwrite', s => req(s.delete(id)));
  },
  async listEvaluations(athleteId) {
    const all = await tx('evaluations', 'readonly', s => req(s.index('athleteId').getAll(athleteId)));
    return all.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  },
  async getEvaluation(id) { return tx('evaluations', 'readonly', s => req(s.get(id))); },
  async saveEvaluation(e) {
    const now = new Date().toISOString();
    // al volver a guardar un análisis se conservan las notas y la revisión ya cargadas
    const prev = e.id ? await this.getEvaluation(e.id) : null;
    const rec = { createdAt: now, ...(prev ? { comments: prev.comments, reviews: prev.reviews } : {}), ...e, id: e.id || newId(), updatedAt: now };
    await tx('evaluations', 'readwrite', s => req(s.put(rec)));
    return rec;
  },
  async deleteEvaluation(id) { await tx('evaluations', 'readwrite', s => req(s.delete(id))); },
  // comentarios (en este dispositivo quedan dentro de la evaluación: son notas del entrenador)
  async listComments(evaluationId) { return ((await this.getEvaluation(evaluationId))?.comments || []).slice(); },
  async addComment(evaluationId, body, who = {}) {
    const e = await this.getEvaluation(evaluationId);
    const c = { id: newId(), evaluationId, body, authorRole: 'coach', authorName: who.name || '', mine: true, createdAt: new Date().toISOString() };
    await this.saveEvaluation({ ...e, comments: [...(e.comments || []), c] });
    return c;
  },
  async deleteComment(id, evaluationId) {
    const e = await this.getEvaluation(evaluationId);
    await this.saveEvaluation({ ...e, comments: (e.comments || []).filter(c => c.id !== id) });
  },
  // revisión para el nadador: archivos dentro de la evaluación (IndexedDB guarda los Blob)
  async listReviewItems(evaluationId) { return ((await this.getEvaluation(evaluationId))?.reviews || []).map(({ blob, ...i }) => ({ ...i, evaluationId })); },
  async addReviewItem(evaluationId, file, { kind, title }) {
    const e = await this.getEvaluation(evaluationId);
    const it = { id: newId(), kind, title, name: file.name || '', type: file.type || '', createdAt: new Date().toISOString(), seenAt: null, blob: file };
    await tx('evaluations', 'readwrite', s => req(s.put({ ...e, reviews: [...(e.reviews || []), it] })));
    return it;
  },
  async deleteReviewItem(id, evaluationId) {
    const e = await this.getEvaluation(evaluationId);
    await tx('evaluations', 'readwrite', s => req(s.put({ ...e, reviews: (e.reviews || []).filter(i => i.id !== id) })));
  },
  async reviewFile(item) {
    const e = await this.getEvaluation(item.evaluationId);
    const it = (e?.reviews || []).find(i => i.id === item.id);
    if (!it) throw new Error('No está más en este dispositivo.');
    return it.blob;
  },
  async markReviewSeen() {},
  // biblioteca de ejercicios del entrenador (en este dispositivo)
  async listDrills() { try { return JSON.parse(localStorage.getItem('swimlab-drills') || '[]'); } catch { return []; } },
  async saveDrill(d) {
    const list = await this.listDrills(), rec = { ...d, id: d.id || newId() };
    localStorage.setItem('swimlab-drills', JSON.stringify([...list.filter(x => x.id !== rec.id), rec].sort((a, b) => a.name.localeCompare(b.name, 'es'))));
    return rec;
  },
  async deleteDrill(id) { localStorage.setItem('swimlab-drills', JSON.stringify((await this.listDrills()).filter(x => x.id !== id))); },
  async sharedSheets() { return []; },
  // copia de seguridad completa (para pasar a otro dispositivo o a la versión con cuentas)
  async exportAll() {
    const athletes = await tx('athletes', 'readonly', s => req(s.getAll()));
    // los archivos de la revisión no viajan en la copia (solo su lista)
    const evaluations = (await tx('evaluations', 'readonly', s => req(s.getAll()))).map(e => (e.reviews ? { ...e, reviews: e.reviews.map(({ blob, ...i }) => i) } : e));
    return { app: 'SwimBull', kind: 'backup', version: 1, exportedAt: new Date().toISOString(), athletes, evaluations };
  },
  async importAll(data) {
    if (!data || data.kind !== 'backup') throw new Error('El archivo no es una copia de seguridad de SwimBull.');
    await tx('athletes', 'readwrite', s => Promise.all(data.athletes.map(a => req(s.put(a)))));
    await tx('evaluations', 'readwrite', s => Promise.all(data.evaluations.map(e => req(s.put(e)))));
    return { athletes: data.athletes.length, evaluations: data.evaluations.length };
  },
};

// Backend activo: local (este dispositivo) o nube (cuenta). La interfaz es la misma.
let active = localStore;
export function useBackend(b) { active = b; }
export const store = new Proxy({}, {
  get(_, k) { const v = active[k]; return typeof v === 'function' ? v.bind(active) : v; },
});
