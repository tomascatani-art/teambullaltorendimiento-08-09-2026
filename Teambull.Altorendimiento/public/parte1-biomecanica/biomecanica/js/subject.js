// Elección del nadador cuando en el cuadro aparece más de una persona.
// Cada cuadro trae hasta N poses candidatas (coordenadas normalizadas 0..1). Se sigue a una sola
// por continuidad de posición; el entrenador puede fijar "anclas": en el cuadro i, el nadador es el
// que está en (x, y). Desde cada ancla el seguimiento vale hasta la próxima.

const TORSO = [11, 12, 23, 24];

// Centro de la pose en unidades de alto de imagen (x se multiplica por el aspecto para no deformar distancias).
export function centerOf(p, aspect = 1) {
  const pick = (ids) => ids.filter(j => p[j] && (p[j][2] ?? 0) > 0.3);
  let ids = pick(TORSO);
  if (ids.length < 2) ids = pick(p.map((_, j) => j));
  if (!ids.length) ids = p.map((_, j) => j);
  let x = 0, y = 0;
  for (const j of ids) { x += p[j][0]; y += p[j][1]; }
  return [x / ids.length * aspect, y / ids.length];
}

// Caja que encierra los puntos visibles, con un margen, en las mismas unidades que centerOf.
export function boxOf(p, aspect = 1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) {
    if ((q[2] ?? 0) < 0.2) continue;
    x0 = Math.min(x0, q[0] * aspect); x1 = Math.max(x1, q[0] * aspect); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
  }
  if (!Number.isFinite(x0)) return null;
  const m = 0.03;
  return [x0 - m, y0 - m, x1 + m, y1 + m];
}

const meanVis = (p) => p.reduce((s, q) => s + (q[2] ?? 0), 0) / p.length;
function prominence(p, aspect) { const b = boxOf(p, aspect); return b ? (b[2] - b[0]) * (b[3] - b[1]) * meanVis(p) : 0; }

// Candidata del cuadro que corresponde a un toque en (x, y) normalizados. Devuelve el índice o -1.
export function candidateAt(cands, x, y, aspect = 1) {
  let best = -1, bd = Infinity;
  cands.forEach((p, k) => {
    const b = boxOf(p, aspect), c = centerOf(p, aspect);
    const inside = b && x * aspect >= b[0] && x * aspect <= b[2] && y >= b[1] && y <= b[3];
    const d = Math.hypot(c[0] - x * aspect, c[1] - y) - (inside ? 1 : 0);
    if (d < bd) { bd = d; best = k; }
  });
  return best >= 0 && bd < 0.25 ? best : -1;
}

// Sigue una pose desde el cuadro `from` en la dirección `dir`, hasta `to` (excluido).
// Busca alrededor de la posición prevista por la velocidad reciente (un nadador que se tira se mueve
// rápido) y con una tolerancia proporcional al tamaño de la persona. Si no la encuentra, sigue
// prediciendo hacia adelante y no se pasa a otra persona que esté quieta donde arrancó.
function follow(cands, choice, start, from, to, dir, aspect, maxStep) {
  let ref = centerOf(start, aspect), size = sizeOf(start, aspect), vx = 0, vy = 0, lost = 0;
  // otras personas vistas mientras se seguía al nadador: cuando se pierde (por ejemplo bajo el agua) no se
  // toma a nadie que esté donde había otra persona quieta (al menos 15 cuadros en el mismo lugar)
  const others = [];
  const near = (c, o) => Math.hypot(c[0] - o.c[0], c[1] - o.c[1]) < 0.4 * o.sz;
  const wasOther = (c, i) => others.some(o => o.n >= 15 && Math.abs(o.i - i) < 240 && near(c, o));
  const addOther = (c, sz, i) => { const o = others.find(q => near(c, q)); if (o) { o.n++; o.i = i; } else others.push({ c, sz, i, n: 1 }); };
  for (let i = from; i !== to; i += dir) {
    const list = cands[i] || [];
    const px = ref[0] + vx * (lost + 1), py = ref[1] + vy * (lost + 1);
    const gate = Math.max(maxStep, 0.6 * size) * Math.min(1 + 0.5 * lost, 2);
    let best = -1, bc = Infinity;
    list.forEach((p, k) => {
      const c = centerOf(p, aspect), d = Math.hypot(c[0] - px, c[1] - py);
      if (d > gate) return;
      if (wasOther(c, i)) return;
      const sz = sizeOf(p, aspect), ratio = sz && size ? Math.max(sz / size, size / sz) : 1;
      const cost = d + 0.15 * (ratio - 1);
      if (cost < bc) { bc = cost; best = k; }
    });
    if (best >= 0) {
      const c = centerOf(list[best], aspect), n = lost + 1;
      vx = 0.5 * vx + 0.5 * (c[0] - ref[0]) / n; vy = 0.5 * vy + 0.5 * (c[1] - ref[1]) / n;
      ref = c; size = 0.7 * size + 0.3 * (sizeOf(list[best], aspect) || size);
      choice[i] = best; lost = 0;
      list.forEach((p, k) => { if (k !== best) addOther(centerOf(p, aspect), sizeOf(p, aspect) || size, i); });
      if (others.length > 200) others.splice(0, others.length - 200);
    } else { choice[i] = -1; lost = Math.min(lost + 1, 30); }
  }
}
// alto de la caja de la persona, como medida de su tamaño en la imagen
function sizeOf(p, aspect) { const b = boxOf(p, aspect); return b ? Math.max(b[3] - b[1], b[2] - b[0]) : 0; }

// anchors: [{ i, x, y }]. Sin anclas se toma como nadador a la persona más visible del primer cuadro con detección.
// Devuelve, por cuadro, el índice de la candidata elegida (-1 = nadie).
export function chooseTrack(cands, anchors = [], aspect = 1, maxStep = 0.08) {
  const n = cands.length, choice = new Array(n).fill(-1);
  const list = anchors.map(a => ({ ...a, k: candidateAt(cands[a.i] || [], a.x, a.y, aspect) }))
    .filter(a => a.k >= 0).sort((a, b) => a.i - b.i);
  if (!list.length) {
    const i0 = cands.findIndex(c => c && c.length);
    if (i0 < 0) return choice;
    let k = 0;
    cands[i0].forEach((p, j) => { if (prominence(p, aspect) > prominence(cands[i0][k], aspect)) k = j; });
    list.push({ i: i0, k });
  }
  list.forEach((a, idx) => {
    choice[a.i] = a.k;
    const p0 = cands[a.i][a.k];
    const end = idx + 1 < list.length ? list[idx + 1].i : n;
    follow(cands, choice, p0, a.i + 1, end, 1, aspect, maxStep);
    if (idx === 0) follow(cands, choice, p0, a.i - 1, -1, -1, aspect, maxStep);
  });
  return choice;
}

// Aplica la elección: frames[i].lm pasa a ser la pose elegida (o null).
export function applyTrack(frames, anchors, aspect) {
  const choice = chooseTrack(frames.map(f => f.cands || (f.lm ? [f.lm] : [])), anchors, aspect);
  return frames.map((f, i) => ({ ...f, lm: choice[i] >= 0 ? (f.cands || [f.lm])[choice[i]] : null }));
}
