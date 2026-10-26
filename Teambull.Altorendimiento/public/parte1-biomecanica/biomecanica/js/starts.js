// Comparar salidas: dos intentos guardados del mismo nadador, alineados en un momento clave que tengan
// los dos (el despegue de los pies si está). Solo se comparan valores medidos y guardados de cada intento.
import { SHORT, MOMENT_IDS } from './moments.js';

// Orden de preferencia para alinear dos intentos en el tiempo.
export const ALIGN_ORDER = ['Despegue de los pies', 'Despegue de las manos', 'Inicio del impulso', 'Entrada de las manos', 'Entrada de los pies', 'Máxima extensión en el vuelo'];

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

// Centro de la cabeza en el cuadro i (píxeles del video): promedio de nariz y orejas a la vista. MediaPipe no
// marca la coronilla, así que es el centro de la cabeza, no la punta. En cuadros sin detección confiable solo
// vale si los puntos están interpolados (hueco corto entre cuadros bien vistos).
export function headAt(T, i, mask) {
  const det = !mask || mask[i];
  const ps = [0, 7, 8].filter(j => Number.isFinite(T[j].x[i]) && Number.isFinite(T[j].y[i]) && (det ? (T[j].rawValid ? T[j].rawValid[i] || T[j].interpolated[i] : true) : T[j].interpolated[i]));
  if (!ps.length) return null;
  return [ps.reduce((a, j) => a + T[j].x[i], 0) / ps.length, ps.reduce((a, j) => a + T[j].y[i], 0) / ps.length, ps.some(j => T[j].interpolated[i])];
}

// Serie compacta para guardar con la evaluación: ángulos confiables o interpolados por cuadro (null si no).
export function packSeries(r) {
  const thr = r.meta.minVisibility;
  const angles = {}, interp = {};
  for (const id of MOMENT_IDS) {
    const s = r.angles[id];
    if (!s) continue;
    angles[id] = s.values.map((v, i) => (Number.isFinite(v) && (s.conf[i] >= thr || s.interp[i]) ? r1(v) : null));
    interp[id] = s.values.map((_, i) => (s.interp[i] ? i : -1)).filter(i => i >= 0);
  }
  const head = r.tracks ? r.times.map((_, i) => { const h = headAt(r.tracks, i, r.quality?.detectedMask); return h ? [Math.round(h[0] * 10) / 10, Math.round(h[1] * 10) / 10] : null; }) : null;
  return { times: r.times.map(t => Math.round(t * 1e4) / 1e4), angles, interp, head };
}

// Datos de comparación de una evaluación de técnica guardada (o null si no tiene momentos marcados).
export function startOf(e) {
  const d = e?.data;
  if (!d || !d.moments?.length) return null;
  return { id: e.id, date: e.date || d.meta?.date || '', title: e.title || '', event: e.event || '', moments: d.moments, flight: d.flight || null, series: d.series || null, fileName: d.meta?.fileName || '', videoPath: e.videoPath || null };
}

// Momento común para alinear: devuelve { label, shift } con shift = tiempo en A − tiempo en B.
export function alignOf(ma, mb) {
  for (const label of ALIGN_ORDER) {
    const a = ma.find(m => m.label === label), b = mb.find(m => m.label === label);
    if (a && b) return { label, shift: a.t - b.t };
  }
  const a = ma.find(m => mb.some(x => x.label === m.label && m.label !== 'Otro'));
  if (a) return { label: a.label, shift: a.t - mb.find(x => x.label === a.label).t };
  return null;
}

// Filas por momento que tienen los dos: tiempo desde el momento de alineación y ángulos con su diferencia.
// a y b: listas [{ label, t, angles: { id: número } }] (formato guardado).
export function compareMoments(a, b, align) {
  const ta0 = align ? a.find(m => m.label === align.label).t : 0, tb0 = align ? b.find(m => m.label === align.label).t : 0;
  const rows = [];
  for (const m of a) {
    if (m.label === 'Otro') continue;
    const o = b.find(x => x.label === m.label);
    if (!o) continue;
    const ang = {};
    for (const id of MOMENT_IDS) {
      const va = m.angles?.[id], vb = o.angles?.[id];
      if (!Number.isFinite(va) && !Number.isFinite(vb)) continue;
      ang[id] = { a: Number.isFinite(va) ? va : null, b: Number.isFinite(vb) ? vb : null, d: Number.isFinite(va) && Number.isFinite(vb) ? va - vb : null };
    }
    rows.push({ label: m.label, ta: m.t - ta0, tb: o.t - tb0, dt: (m.t - ta0) - (o.t - tb0), angles: ang });
  }
  return rows.sort((x, y) => x.ta - y.ta);
}

// Diferencias del vuelo (formato guardado: { time, takeoff, takeoffErr, entry, entryErr, body, bodyErr }).
export function compareFlight(fa, fb) {
  if (!fa || !fb) return [];
  const row = (label, k, ek, unit, dec) => {
    const a = fa[k], b = fb[k];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    // margen de la diferencia: suma cuadrática de los dos márgenes; en tiempo, un cuadro por intento
    const e = ek ? Math.hypot(Math.max(1, fa[ek] || 0), Math.max(1, fb[ek] || 0)) : null;
    return { label, a, b, d: a - b, err: e, unit, dec };
  };
  return [row('Tiempo de vuelo', 'time', null, 's', 2), row('Ángulo de despegue', 'takeoff', 'takeoffErr', '°', 0), row('Ángulo de entrada', 'entry', 'entryErr', '°', 0), row('Cuerpo al entrar', 'body', 'bodyErr', '°', 0)].filter(Boolean);
}

// Vuelo guardado a partir del resultado de flightOf (para comparar el intento abierto con uno guardado).
export const flightSaved = (fl) => (fl && !fl.error && fl.takeoff ? { time: fl.time, frameDur: fl.frameDur, takeoff: fl.takeoff.deg, takeoffErr: fl.takeoff.err, entry: fl.entry.deg, entryErr: fl.entry.err, body: fl.body?.deg ?? null, bodyErr: fl.body?.err ?? null } : null);

// Columnas de ángulos con dato en alguno de los dos intentos.
export const cmpCols = (rows) => MOMENT_IDS.filter(id => rows.some(r => r.angles[id]));
export { SHORT };
