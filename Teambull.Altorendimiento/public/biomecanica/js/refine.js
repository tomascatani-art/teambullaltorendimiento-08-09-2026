// Limpieza de los puntos del esqueleto antes de medir, y correcciones a mano del entrenador.
//  1. Izquierda/derecha cruzadas: en toma lateral el modelo a veces intercambia el brazo o la pierna
//     izquierda con la derecha durante uno o varios cuadros. Se corrige por continuidad con los cuadros
//     anteriores (la posición prevista por la velocidad reciente).
//  2. Saltos aislados: un punto que se va lejos en un solo cuadro y vuelve se descarta (después se
//     interpola como cualquier hueco corto y queda marcado como interpolado).
//  3. Correcciones a mano: el entrenador arrastra un punto a su lugar en un cuadro; la diferencia con lo
//     detectado se reparte hacia los cuadros vecinos y, entre dos correcciones del mismo punto, se
//     interpola. Los puntos corregidos quedan marcados.
// Coordenadas normalizadas (0..1) como las entrega el modelo: [x, y, visibilidad, presencia].

const CHAINS = [
  // [lado izquierdo, lado derecho]: hombro-codo-muñeca-mano, cadera-rodilla-tobillo-pie
  { name: 'brazos', L: [11, 13, 15, 17, 19, 21], R: [12, 14, 16, 18, 20, 22], decide: [13, 15] },
  { name: 'piernas', L: [23, 25, 27, 29, 31], R: [24, 26, 28, 30, 32], decide: [25, 27] },
];
const VIS = 0.5;

const seen = (p) => p && (p[2] ?? 0) >= VIS && Math.min(p[2] ?? 0, p[3] ?? 1) >= VIS;

// Largo del tronco típico (mediana), en unidades de alto de imagen.
export function torsoLength(frames, aspect = 1) {
  const L = [];
  for (const f of frames) {
    const p = f.lm;
    if (!p || ![11, 12, 23, 24].every(j => seen(p[j]))) continue;
    const sx = (p[11][0] + p[12][0]) / 2 * aspect, sy = (p[11][1] + p[12][1]) / 2;
    const hx = (p[23][0] + p[24][0]) / 2 * aspect, hy = (p[23][1] + p[24][1]) / 2;
    L.push(Math.hypot(sx - hx, sy - hy));
  }
  if (!L.length) return 0.15;
  L.sort((a, b) => a - b);
  return L[L.length >> 1];
}

// Corrige intercambios izquierda/derecha. Devuelve { frames, swaps: [{ i, chain }] } sin modificar la entrada.
export function fixSwaps(frames, aspect = 1) {
  const torso = torsoLength(frames, aspect);
  const out = frames.map(f => (f.lm ? { ...f, lm: f.lm.map(q => q.slice()) } : { ...f }));
  const swaps = [];
  for (const ch of CHAINS) {
    const hist = []; // últimos cuadros aceptados: { i, pos: { j: [x, y] } }
    for (let i = 0; i < out.length; i++) {
      const p = out[i].lm;
      if (!p) continue;
      const last = hist[hist.length - 1];
      if (last && i - last.i <= 6) {
        const prev2 = hist.length > 1 && last.i - hist[hist.length - 2].i <= 6 ? hist[hist.length - 2] : null;
        // posición prevista de cada punto (velocidad del último tramo, a lo sumo medio tronco por cuadro)
        const pred = (j) => {
          const a = last.pos[j];
          if (!a) return null;
          const b = prev2 && prev2.pos[j];
          if (!b) return a;
          const k = (i - last.i) / (last.i - prev2.i);
          let vx = (a[0] - b[0]) * k, vy = (a[1] - b[1]) * k;
          const v = Math.hypot(vx, vy), lim = 0.5 * torso * (i - last.i);
          if (v > lim) { vx *= lim / v; vy *= lim / v; }
          return [a[0] + vx, a[1] + vy];
        };
        let keep = 0, swap = 0, n = 0;
        ch.decide.forEach((jl) => {
          const jr = ch.R[ch.L.indexOf(jl)];
          const l = p[jl], r = p[jr], pl = pred(jl), pr = pred(jr);
          if (!seen(l) || !seen(r) || !pl || !pr) return;
          const d = (q, t) => Math.hypot(q[0] * aspect - t[0], q[1] - t[1]);
          keep += d(l, pl) + d(r, pr);
          swap += d(r, pl) + d(l, pr);
          n++;
        });
        // se cambia solo si cruzado encaja mucho mejor y la diferencia es grande respecto del cuerpo
        if (n && swap < 0.5 * keep && keep - swap > 0.3 * torso * n) {
          ch.L.forEach((jl, k) => { const jr = ch.R[k]; const t = p[jl]; p[jl] = p[jr]; p[jr] = t; });
          swaps.push({ i, chain: ch.name });
        }
      }
      const pos = {};
      for (const j of [...ch.L, ...ch.R]) if (seen(p[j])) pos[j] = [p[j][0] * aspect, p[j][1]];
      if (ch.decide.some(j => pos[j])) { hist.push({ i, pos }); if (hist.length > 3) hist.shift(); }
    }
  }
  return { frames: out, swaps };
}

// Descarta saltos aislados: el punto se aleja de la línea entre sus dos vecinos mucho más de lo que se
// mueven los vecinos entre sí. Devuelve { frames, spikes: [{ i, j }] }.
export const SPIKE_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
export function despike(frames, aspect = 1) {
  const torso = torsoLength(frames, aspect);
  const out = frames.map(f => (f.lm ? { ...f, lm: f.lm.map(q => q.slice()) } : { ...f }));
  const spikes = [];
  for (const j of SPIKE_JOINTS) {
    for (let i = 1; i < frames.length - 1; i++) {
      const a = frames[i - 1].lm?.[j], p = frames[i].lm?.[j], b = frames[i + 1].lm?.[j];
      if (!seen(a) || !seen(p) || !seen(b)) continue;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const dev = Math.hypot((p[0] - mx) * aspect, p[1] - my);
      const gap = Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]);
      if (dev > 0.25 * torso && dev > 1.5 * gap) {
        out[i].lm[j][2] = 0; // queda como no visto: se interpola si el hueco es corto
        spikes.push({ i, j });
      }
    }
  }
  return { frames: out, spikes };
}

// Correcciones a mano. edits: [{ j, i, x, y }] (x, y normalizados). fps para el alcance de cada corrección.
// Cada cuadro tocado lleva f.manual = { j: 1 (puesto a mano) | 2 (ajustado desde una corrección cercana) }.
export function applyEdits(frames, edits, fps, { reach = 0.3, bridge = 2 } = {}) {
  if (!edits || !edits.length) return frames;
  const span = Math.max(1, Math.round(reach * fps)), maxBridge = Math.round(bridge * fps);
  const out = frames.map(f => ({ ...f, lm: f.lm ? f.lm.map(q => q.slice()) : null, manual: { ...(f.manual || {}) } }));
  const det = (i, j) => { const q = frames[i].lm?.[j]; return seen(q) ? q : null; };
  const byJoint = {};
  for (const e of edits) (byJoint[e.j] ||= []).push(e);
  for (const [jk, list] of Object.entries(byJoint)) {
    const j = +jk;
    list.sort((a, b) => a.i - b.i);
    const offOf = (e) => { const d = det(e.i, j); return d ? [e.x - d[0], e.y - d[1]] : null; };
    for (let i = 0; i < out.length; i++) {
      let a = null, b = null;
      for (const e of list) { if (e.i <= i) a = e; if (e.i >= i && !b) b = e; }
      let pos = null, kind = 2;
      if (a && a.i === i) { pos = [a.x, a.y]; kind = 1; }
      else if (a && b && b.i - a.i <= maxBridge) {
        const u = (i - a.i) / (b.i - a.i), d = det(i, j), oa = offOf(a), ob = offOf(b);
        pos = d && oa && ob ? [d[0] + oa[0] + (ob[0] - oa[0]) * u, d[1] + oa[1] + (ob[1] - oa[1]) * u]
          : [a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u];
      } else {
        const near = [a, b].filter(Boolean).map(e => ({ e, d: Math.abs(e.i - i) })).filter(o => o.d <= span).sort((x, y) => x.d - y.d)[0];
        const d = det(i, j), o = near && offOf(near.e);
        if (near && d && o) { const w = 1 - near.d / (span + 1); pos = [d[0] + o[0] * w, d[1] + o[1] * w]; }
      }
      if (!pos) continue;
      if (!out[i].lm) out[i].lm = Array.from({ length: 33 }, () => [0, 0, 0, 0]);
      out[i].lm[j] = [pos[0], pos[1], 1, 1];
      out[i].manual[j] = kind;
    }
  }
  return out;
}
