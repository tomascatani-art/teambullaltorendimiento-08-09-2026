// Vuelo de la salida: recorrido de la cadera (punto medio de las dos caderas, aproximación del centro de
// masa) entre el despegue y la entrada que marcó el entrenador. En el aire la cadera sigue una parábola:
// x lineal y y cuadrática en el tiempo. Se ajusta por mínimos cuadrados y de ahí salen la dirección del
// movimiento al despegar y al entrar, con su margen calculado del error de ajuste. Ángulos en el plano
// de la imagen: valen con toma lateral, cámara fija y nivelada.

const TAKEOFF = ['Despegue de los pies'], ENTRY = ['Entrada de las manos', 'Entrada de los pies'];

// Inversa de una matriz 3×3 (o null si es singular).
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m.flat();
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [[A, -(b * i - c * h), b * f - c * e], [B, a * i - c * g, -(a * f - c * d)], [C, -(a * h - b * g), a * e - b * d]].map(r => r.map(v => v / det));
}

// Ajuste polinomial de grado 1 o 2 en t (centrado en tc). Devuelve coeficientes, covarianza sin escalar y residuos.
function polyfit(ts, vs, deg, tc) {
  const n = deg + 1, X = ts.map(t => Array.from({ length: n }, (_, k) => (t - tc) ** k));
  const XtX = Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => (r < n && c < n ? X.reduce((s, x) => s + x[r] * x[c], 0) : (r === c ? 1 : 0))));
  const Xty = [0, 1, 2].map(r => (r < n ? X.reduce((s, x, k) => s + x[r] * vs[k], 0) : 0));
  const Inv = inv3(XtX);
  if (!Inv) return null;
  const beta = [0, 1, 2].map(r => Inv[r].reduce((s, v, c) => s + v * Xty[c], 0)).slice(0, n);
  const res = X.map((x, k) => vs[k] - x.reduce((s, v, j) => s + v * beta[j], 0));
  return { beta, cov: Inv, res };
}

const pick = (rows, names) => names.map(n => rows.find(r => r.label === n)).find(Boolean) || null;

// r: resultado del análisis; rows: momentos (momentRows). Devuelve null si faltan los dos momentos.
// cam: movimiento de la cámara ({ toBase }) para llevar la cadera al primer cuadro antes de ajustar.
export function flightOf(r, rows, cam = null) {
  const a = pick(rows, TAKEOFF), b = pick(rows, ENTRY);
  if (!a || !b) return null;
  if (b.frame <= a.frame) return { error: 'La entrada tiene que estar marcada después del despegue.' };
  const L = r.tracks[23], R = r.tracks[24];
  const pts = [];
  for (let i = a.frame; i <= b.frame; i++) {
    if (!L.rawValid[i] || !R.rawValid[i]) continue;
    let x = (L.x[i] + R.x[i]) / 2, y = (L.y[i] + R.y[i]) / 2;
    if (cam) { const T = cam.toBase[i]; [x, y] = [T[0] * x - T[1] * y + T[2], T[1] * x + T[0] * y + T[3]]; }
    pts.push({ i, t: r.times[i], x, y });
  }
  const base = { a, b, time: b.t - a.t, frameDur: 1 / r.meta.fps, pts };
  const span = b.frame - a.frame + 1;
  if (pts.length < 5 || pts.length < span * 0.6) return { ...base, error: `La cadera se vio con confianza en ${pts.length} de ${span} cuadros del vuelo: no alcanza para ajustar la trayectoria.` };
  const tc = (a.t + b.t) / 2, ts = pts.map(p => p.t);
  const fx = polyfit(ts, pts.map(p => p.x), 1, tc), fy = polyfit(ts, pts.map(p => p.y), 2, tc);
  if (!fx || !fy) return { ...base, error: 'No se pudo ajustar la trayectoria.' };
  const n = pts.length;
  const s2x = fx.res.reduce((s, v) => s + v * v, 0) / Math.max(1, n - 2);
  const s2y = fy.res.reduce((s, v) => s + v * v, 0) / Math.max(1, n - 3);
  const rms = Math.sqrt((s2x * (n - 2) + s2y * (n - 3)) / Math.max(1, 2 * n - 5));
  // velocidad y su varianza en un instante t: vx = bx1; vy = by1 + 2·by2·(t−tc)
  const dirAt = (t) => {
    const u = t - tc, vx = fx.beta[1], vy = fy.beta[1] + 2 * fy.beta[2] * u;
    const varx = s2x * fx.cov[1][1];
    const vary = s2y * (fy.cov[1][1] + 4 * u * fy.cov[1][2] + 4 * u * u * fy.cov[2][2]);
    const sp2 = vx * vx + vy * vy;
    // ángulo sobre la horizontal: positivo = subiendo (en la imagen y crece hacia abajo)
    const deg = Math.atan2(-vy, Math.abs(vx)) * 180 / Math.PI;
    const err = Math.sqrt((vy * vy * varx + vx * vx * vary) / (sp2 * sp2)) * 180 / Math.PI;
    return { deg, err, vx, vy };
  };
  // ancho del cuerpo como escala para juzgar el residuo (hombro a cadera, mediana en el vuelo)
  const trunk = pts.map(p => { const s = r.tracks[11], q = r.tracks[12]; return Number.isFinite(s.x[p.i]) && Number.isFinite(q.x[p.i]) ? Math.hypot((s.x[p.i] + q.x[p.i]) / 2 - p.x, (s.y[p.i] + q.y[p.i]) / 2 - p.y) : NaN; }).filter(Number.isFinite).sort((u, v) => u - v);
  const trunkLen = trunk.length ? trunk[trunk.length >> 1] : NaN;
  const warn = [];
  if (Number.isFinite(trunkLen) && rms > 0.08 * trunkLen) warn.push('La cadera se aparta de una parábola más de lo esperable: puede haberse movido la cámara o fallado la detección en algunos cuadros.');
  if (fy.beta[2] <= 0) warn.push('La trayectoria no se curva hacia abajo como un vuelo: revisá los cuadros marcados o si la cámara se movió.');
  // ángulo del cuerpo al entrar: línea cadera → muñeca más adelantada
  let body = null;
  const i = b.frame, hip = [(L.x[i] + R.x[i]) / 2, (L.y[i] + R.y[i]) / 2];
  const wr = [15, 16].filter(j => r.tracks[j].rawValid[i]).map(j => [r.tracks[j].x[i], r.tracks[j].y[i]]);
  if (wr.length && L.rawValid[i] && R.rawValid[i]) {
    const dir = Math.sign(fx.beta[1]) || 1;
    const w = wr.sort((p, q) => dir * (q[0] - p[0]))[0];
    const len = Math.hypot(w[0] - hip[0], w[1] - hip[1]);
    const e = 3 * Math.sqrt(2) / Math.max(1, len) * 180 / Math.PI; // ~3 px de error por punto de pose
    body = { deg: Math.atan2(w[1] - hip[1], Math.abs(w[0] - hip[0])) * 180 / Math.PI, err: e, hip, wrist: w };
  }
  const curve = [];
  for (let k = 0; k <= 30; k++) { const t = a.t + (b.t - a.t) * k / 30, u = t - tc; curve.push([fx.beta[0] + fx.beta[1] * u, fy.beta[0] + fy.beta[1] * u + fy.beta[2] * u * u]); }
  return { ...base, takeoff: dirAt(a.t), entry: dirAt(b.t), body, rms, trunkLen, curve, warn, at: (t) => { const u = t - tc; return [fx.beta[0] + fx.beta[1] * u, fy.beta[0] + fy.beta[1] * u + fy.beta[2] * u * u]; } };
}

// Dibujo sobre el video: puntos medidos, parábola ajustada y flechas de dirección al despegar y entrar.
// map: lleva un punto de las coordenadas del ajuste a la imagen que se dibuja (cámara en mano).
export function drawFlight(ctx, fl, sc, k = 1, color = '#38d9ff', map = null) {
  if (!fl || fl.error || !fl.curve) return;
  const M = map || ((p) => p);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 4.5 * k; ctx.setLineDash([]);
  const path = () => { ctx.beginPath(); fl.curve.forEach((q, i) => { const [x, y] = M(q); return i ? ctx.lineTo(x * sc, y * sc) : ctx.moveTo(x * sc, y * sc); }); };
  path(); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 2 * k; ctx.setLineDash([6 * k, 5 * k]); path(); ctx.stroke(); ctx.setLineDash([]);
  for (const p of fl.pts) { const [x, y] = M([p.x, p.y]); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x * sc, y * sc, 2.6 * k, 0, Math.PI * 2); ctx.fill(); }
  const arrow = (t, d, label) => {
    const p0 = fl.at(t), [x, y] = M(p0), p1 = M([p0[0] + d.vx * 0.01, p0[1] + d.vy * 0.01]);
    const vx = p1[0] - x, vy = p1[1] - y, L = Math.hypot(vx, vy) || 1, len = 60 * k;
    const ux = vx / L, uy = vy / L, X = x * sc, Y = y * sc, ex = X + ux * len, ey = Y + uy * len;
    ctx.strokeStyle = color; ctx.lineWidth = 2.5 * k;
    ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(ex, ey); ctx.stroke();
    const ang = Math.atan2(uy, ux);
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - 10 * k * Math.cos(ang - 0.45), ey - 10 * k * Math.sin(ang - 0.45));
    ctx.moveTo(ex, ey); ctx.lineTo(ex - 10 * k * Math.cos(ang + 0.45), ey - 10 * k * Math.sin(ang + 0.45)); ctx.stroke();
    // referencia horizontal punteada
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1 * k; ctx.setLineDash([3 * k, 3 * k]);
    ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.sign(ux || 1) * len, Y); ctx.stroke(); ctx.setLineDash([]);
    const fs = Math.round(13 * k);
    ctx.font = `600 ${fs}px "Geist Mono", monospace`;
    const w = ctx.measureText(label).width, tx = ex + 6 * k, ty = ey + (uy < 0 ? -4 : fs) * 1;
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(tx - 3 * k, ty - fs, w + 6 * k, fs + 5 * k);
    ctx.fillStyle = '#fff'; ctx.fillText(label, tx, ty);
  };
  const f0 = (v) => v.toFixed(0);
  arrow(fl.a.t, fl.takeoff, `${f0(fl.takeoff.deg)}° ±${f0(Math.max(1, fl.takeoff.err))}`);
  arrow(fl.b.t, fl.entry, `${f0(fl.entry.deg)}° ±${f0(Math.max(1, fl.entry.err))}`);
  ctx.restore();
}
