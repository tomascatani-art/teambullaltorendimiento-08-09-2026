// ¿Cambio real o ruido? Entre dos evaluaciones, una diferencia solo cuenta como cambio si supera lo que
// varía la medición por sí sola. Cada valor trae su error estándar (se): la variación entre ciclos del
// mismo video dividida por √n, o el error de marcar a mano un cuadro. Con dos valores independientes, el
// cambio mínimo detectable al 95 % es 1,96·√(se1² + se2²).
export const Z95 = 1.96;

export function seOfMean(xs) {
  const v = xs.filter(Number.isFinite);
  if (v.length < 3) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
  return sd / Math.sqrt(v.length);
}

// a, b: { v, se } (b es el más reciente). Devuelve { d, mdc, verdict } con verdict:
// 'real' (supera el cambio mínimo detectable), 'ruido' (no lo supera) o 'sin margen' (falta el error de alguno).
export function realChange(a, b) {
  if (!a || !b || !Number.isFinite(a.v) || !Number.isFinite(b.v)) return null;
  const d = b.v - a.v;
  if (!Number.isFinite(a.se) || !Number.isFinite(b.se)) return { d, mdc: null, verdict: 'sin margen' };
  const mdc = Z95 * Math.hypot(a.se, b.se);
  return { d, mdc, verdict: Math.abs(d) > mdc ? 'real' : 'ruido' };
}

export const VERDICT_TEXT = { real: 'cambio real', ruido: 'dentro del ruido', 'sin margen': 'sin margen de error' };
