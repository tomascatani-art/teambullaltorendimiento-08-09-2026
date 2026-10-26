// Velocidad continua: la línea seguida sobre el nadador (posición por cuadro, en píxeles del video) se
// pasa a metros con las referencias del andarivel (calibración 1D, proyectiva con 3 referencias) y se
// deriva con un ajuste lineal local. Solo vale con la cámara fija durante todo el tramo.
import { measureAlongLine } from './race.js';

// Distancia (m) de cada punto de la línea. refs: [{ m, p:[x,y] }] con al menos 2 puntos marcados.
// frame: { w, h, margin } descarta los puntos pegados al borde del cuadro, donde el seguimiento falla.
export function distanceSeries(pts, refs, frame = null) {
  const R = refs.filter(r => r.p && Number.isFinite(r.m));
  if (R.length < 2) return [];
  if (frame) pts = pts.filter(q => q.x >= frame.margin && q.y >= frame.margin && q.x <= frame.w - frame.margin && q.y <= frame.h - frame.margin);
  return pts.map(q => { const r = measureAlongLine(R, [q.x, q.y]); return r && Number.isFinite(r.meters) ? { t: q.t, d: r.meters, x: q.x, y: q.y } : null; }).filter(Boolean);
}

// Metros por píxel de video en un punto, a lo largo de la línea de referencias.
export function metersPerPx(refs, p) {
  const R = refs.filter(r => r.p);
  const a = R[0].p, b = R[R.length - 1].p, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const m0 = measureAlongLine(R, p), m1 = measureAlongLine(R, [p[0] + u[0], p[1] + u[1]]);
  return m0 && m1 ? Math.abs(m1.meters - m0.meters) : NaN;
}

// Velocidad en cada punto: pendiente de la recta que mejor ajusta la distancia en una ventana de `win`
// segundos centrada en el punto. sigmaD: error de posición (m) de cada punto, para el margen de la velocidad.
export function speedSeries(series, { win = 0.4, sigmaD = () => 0 } = {}) {
  const out = [];
  for (let i = 0; i < series.length; i++) {
    const t0 = series[i].t;
    const w = series.filter(s => Math.abs(s.t - t0) <= win / 2 + 1e-9);
    // solo ventanas completas: en los bordes de la línea la pendiente sale sesgada
    if (w.length < 3 || w[0].t > t0 - win / 2 + win * 0.1 || w[w.length - 1].t < t0 + win / 2 - win * 0.1) continue;
    const n = w.length, mt = w.reduce((a, s) => a + s.t, 0) / n, md = w.reduce((a, s) => a + s.d, 0) / n;
    let sxx = 0, sxy = 0;
    for (const s of w) { sxx += (s.t - mt) ** 2; sxy += (s.t - mt) * (s.d - md); }
    if (sxx <= 0) continue;
    const v = sxy / sxx;
    // desvío de la pendiente con error de posición independiente en cada punto
    const sv = (sigmaD(series[i]) || 0) / Math.sqrt(sxx);
    out.push({ t: t0, d: series[i].d, v, sv });
  }
  return out;
}

// Tiempo y velocidad media entre marcas cada `step` metros (cruces interpolados de la distancia).
export function segmentSpeeds(series, step = 5) {
  if (series.length < 2) return [];
  const cross = (m) => {
    for (let i = 1; i < series.length; i++) {
      const a = series[i - 1], b = series[i];
      if ((a.d - m) * (b.d - m) <= 0 && a.d !== b.d) return a.t + (m - a.d) / (b.d - a.d) * (b.t - a.t);
    }
    return null;
  };
  const dmin = Math.min(...series.map(s => s.d)), dmax = Math.max(...series.map(s => s.d));
  const segs = [];
  for (let m = Math.ceil(dmin / step) * step; m + step <= dmax + 1e-9; m += step) {
    const ta = cross(m), tb = cross(m + step);
    if (ta != null && tb != null && tb > ta) segs.push({ from: m, to: m + step, time: tb - ta, speed: step / (tb - ta) });
  }
  return segs;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');

// Gráfico de velocidad contra distancia, con la banda del margen y tooltip por punto.
export function speedChart(sp, width = 640) {
  if (sp.length < 2) return '';
  const W = Math.max(300, Math.round(width)), H = 230, L = 46, R = 14, T = 12, B = 34;
  const xs = sp.map(s => s.d), lo = sp.map(s => s.v - s.sv), hi = sp.map(s => s.v + s.sv);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 - x0 < 1) x1 = x0 + 1;
  let y0 = Math.max(0, Math.min(...lo)), y1 = Math.max(...hi);
  const raw = (y1 - y0) / 4 || 0.5, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map(m => m * mag).find(v => v >= raw);
  y0 = Math.floor(y0 / step) * step; y1 = Math.ceil(y1 / step) * step;
  const X = (v) => L + (v - x0) / (x1 - x0) * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  let grid = '';
  for (let v = y0; v <= y1 + step / 2; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="evo-grid"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" class="evo-tick">${f(v, step < 0.1 ? 2 : 1)}</text>`;
  const xstep = (x1 - x0) > 20 ? 5 : (x1 - x0) > 8 ? 2 : 1;
  for (let m = Math.ceil(x0 / xstep) * xstep; m <= x1; m += xstep) grid += `<text x="${X(m)}" y="${H - 12}" text-anchor="middle" class="evo-tick">${m} m</text>`;
  const band = `M${sp.map(s => `${X(s.d).toFixed(1)},${Y(s.v + s.sv).toFixed(1)}`).join(' L')} L${sp.slice().reverse().map(s => `${X(s.d).toFixed(1)},${Y(Math.max(y0, s.v - s.sv)).toFixed(1)}`).join(' L')} Z`;
  const line = sp.map((s, i) => `${i ? 'L' : 'M'}${X(s.d).toFixed(1)},${Y(s.v).toFixed(1)}`).join(' ');
  const every = Math.max(1, Math.round(sp.length / 60));
  const shown = sp.filter((_, i) => i % every === 0), hit = Math.max(3, Math.min(10, (W - L - R) / shown.length / 2));
  const dots = shown.map(s => `<g class="evo-pt" tabindex="0" data-tip="${esc(`${f(s.d, 1)} m · ${f(s.v)} ± ${f(s.sv)} m/s`)}"><circle cx="${X(s.d)}" cy="${Y(s.v)}" r="${hit.toFixed(1)}" class="evo-hit"/><circle cx="${X(s.d)}" cy="${Y(s.v)}" r="3" class="evo-dot speed-dot"/></g>`).join('');
  return `<div class="evo-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Velocidad según la distancia">${grid}<path d="${band}" class="speed-band"/><path d="${line}" class="evo-line"/>${dots}</svg><div class="evo-tip mono" hidden></div></div>`;
}
