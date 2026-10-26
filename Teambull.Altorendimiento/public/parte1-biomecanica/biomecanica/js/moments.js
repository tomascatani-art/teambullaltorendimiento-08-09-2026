// Momentos clave del modo técnica (despegue, vuelo, entrada…): el entrenador marca cuadros y la app
// muestra los grados de cada articulación en ese instante, solo si el modelo la vio con confianza.
import { ANGLE_DEFS, EXTRA_SERIES } from './analysis.js';

// Colores de las series del gráfico, en orden fijo (validados para fondo claro y oscuro).
export const SERIES_COLORS = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500'] };
export const MAX_SERIES = 4;

// Etiqueta corta para tabla y leyenda.
export const SHORT = {
  elbowL: 'Codo izq.', elbowR: 'Codo der.', shoulderL: 'Hombro izq.', shoulderR: 'Hombro der.',
  hipL: 'Cadera izq.', hipR: 'Cadera der.', kneeL: 'Rodilla izq.', kneeR: 'Rodilla der.', trunkIncl: 'Tronco',
  armL: 'Mano izq.', armR: 'Mano der.',
};

export const isDegree = (id) => !/^arm[LR]$/.test(id);

// Elegir o quitar una serie: las de grados se combinan (hasta 4); la posición de la mano va sola
// porque tiene otra unidad y no comparte eje. colors: { id: índice de color } se conserva al quitar otras.
export function toggleSeries(sel, colors, id) {
  let next = sel.slice();
  const c = { ...colors };
  if (next.includes(id)) {
    if (next.length === 1) return { sel: next, colors: c };
    next = next.filter(x => x !== id); delete c[id];
    return { sel: next, colors: c };
  }
  if (isDegree(id) !== isDegree(next[0] ?? id)) { next = []; for (const k of Object.keys(c)) delete c[k]; }
  if (next.length >= MAX_SERIES) return { sel: next, colors: c, full: true };
  const used = new Set(next.map(x => c[x]));
  c[id] = [0, 1, 2, 3].find(k => !used.has(k));
  next.push(id);
  return { sel: next, colors: c };
}

// Valor de una serie de ángulo en el cuadro i: null si no hay dato o la confianza es baja.
export function angleAt(r, id, i) {
  const s = r.angles[id];
  if (!s) return null;
  const v = s.values[i];
  if (!Number.isFinite(v)) return null;
  // puntos interpolados (huecos cortos) se muestran marcados; los demás necesitan confianza suficiente
  if (s.interp[i]) return { v, interp: true };
  if (s.conf[i] < r.meta.minVisibility) return null;
  return { v, interp: false };
}

export const MOMENT_IDS = [...ANGLE_DEFS.map(d => d.id), ...EXTRA_SERIES.map(d => d.id)];

// moments: [{ frame, label }] → filas ordenadas por tiempo, con t, Δt desde el primero y los ángulos.
export function momentRows(r, moments) {
  const rows = moments.filter(m => m.frame >= 0 && m.frame < r.times.length).slice().sort((a, b) => a.frame - b.frame);
  const t0 = rows.length ? r.times[rows[0].frame] : 0;
  return rows.map((m, k) => ({
    n: k + 1, frame: m.frame, label: m.label, t: r.times[m.frame], dt: r.times[m.frame] - t0,
    prev: k ? r.times[m.frame] - r.times[rows[k - 1].frame] : null,
    angles: Object.fromEntries(MOMENT_IDS.map(id => [id, angleAt(r, id, m.frame)])),
  }));
}

// Columnas con al menos un dato en los momentos marcados.
export const usedCols = (rows) => MOMENT_IDS.filter(id => rows.some(row => row.angles[id]));
