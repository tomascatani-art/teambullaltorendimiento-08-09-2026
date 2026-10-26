// Verificación de la precisión con algo conocido filmado con la misma cámara: una distancia (dos marcas o
// conos a distancia conocida que no se usaron para calibrar) o un ángulo (una escuadra, la pared contra la
// corchera). El error medido se informa tal cual, junto al resultado: es el error real de esa toma.

// Distancia medida entre dos puntos del video con la calibración (función toMeters: [x, y] → metros a lo largo).
export function distanceCheck(real, p, q, toMeters, method) {
  const a = toMeters(p), b = toMeters(q);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(real > 0)) return null;
  const measured = Math.abs(b - a), err = measured - real;
  return { kind: 'distance', real, measured, err, pct: 100 * err / real, method, p, q, at: new Date().toISOString() };
}

// Ángulo en el vértice b (tres puntos) contra el valor real.
export function angleCheck(real, a, b, c) {
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const n = Math.hypot(...v1) * Math.hypot(...v2);
  if (!n || !Number.isFinite(real)) return null;
  const measured = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / n))) * 180 / Math.PI;
  return { kind: 'angle', real, measured, err: measured - real, a, b, c, at: new Date().toISOString() };
}

// Resumen de varias verificaciones del mismo tipo: error medio, máximo y la cantidad.
export function checkSummary(list) {
  if (!list?.length) return null;
  const errs = list.map(c => (c.kind === 'distance' ? Math.abs(c.pct) : Math.abs(c.err)));
  return { n: list.length, mean: errs.reduce((s, v) => s + v, 0) / errs.length, max: Math.max(...errs), unit: list[0].kind === 'distance' ? '%' : '°' };
}

const f = (v, d) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');
export function checkText(c) {
  return c.kind === 'distance'
    ? `Distancia real ${f(c.real, 2)} m, medida ${f(c.measured, 2)} m: error ${c.err >= 0 ? '+' : ''}${f(c.err, 2)} m (${c.pct >= 0 ? '+' : ''}${f(c.pct, 1)} %)${c.method ? `, ${c.method}` : ''}.`
    : `Ángulo real ${f(c.real, 1)}°, medido ${f(c.measured, 1)}°: error ${c.err >= 0 ? '+' : ''}${f(c.err, 1)}°.`;
}
