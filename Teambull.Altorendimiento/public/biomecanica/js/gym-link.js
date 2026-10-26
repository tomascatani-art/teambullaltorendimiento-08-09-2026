// Enlace entre dos dispositivos con un código de 4 cifras: el celular que filma manda las velocidades y la
// tablet que mira el deportista las muestra. Por dónde viaja, según dónde esté abierta la app:
// - publicada en claude.ai: la sala del artefacto (mismo usuario en los dos dispositivos);
// - instalada con la nube (Supabase), o dentro de Team Bull con su nube: un canal en tiempo real;
// - si no hay ninguno: BroadcastChannel (solo entre pestañas del mismo dispositivo, sirve para probar).
// Los mensajes grandes (la oferta de video) se parten en trozos de 3000 caracteres.
import { cloud } from './auth.js';
import { inTeamBull, connectTeamBull, teambullNube } from './store-teambull.js';

const CHUNK = 3000;

export const newCode = () => String(Math.floor(1000 + Math.random() * 9000));

function chunker(rawSend, onMsg) {
  const parts = new Map();
  return {
    send(obj) {
      const s = JSON.stringify(obj);
      if (s.length <= CHUNK) return rawSend({ m: obj });
      const id = Math.random().toString(36).slice(2, 10), n = Math.ceil(s.length / CHUNK);
      for (let i = 0; i < n; i++) rawSend({ id, i, n, s: s.slice(i * CHUNK, (i + 1) * CHUNK) });
    },
    recv(d) {
      if (!d || typeof d !== 'object') return;
      if (d.m) return onMsg(d.m);
      if (typeof d.id !== 'string' || !(d.n > 0) || !(d.n < 200)) return;
      const p = parts.get(d.id) || []; p[d.i] = d.s; parts.set(d.id, p);
      if (p.filter(x => typeof x === 'string').length === d.n) {
        parts.delete(d.id);
        try { onMsg(JSON.parse(p.join(''))); } catch { /* trozo dañado: se descarta */ }
      }
    },
  };
}

// Devuelve { kind, send(obj), close() } u lanza un error con un mensaje para mostrar.
let _tbSb = null;
async function canalNube() {
  if (cloud.enabled && typeof cloud.sb?.channel === 'function') return cloud.sb;
  if (!inTeamBull || !window.supabase?.createClient) return null;
  await connectTeamBull();
  const n = teambullNube();
  if (!n) return null;
  // solo mensajes en vivo entre los dos aparatos: no lee ni escribe datos
  if (!_tbSb) _tbSb = window.supabase.createClient(n.url, n.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return _tbSb;
}

export async function openLink(code, onMsg) {
  if (!/^\d{4}$/.test(code)) throw new Error('El código tiene 4 números.');
  const name = 'swimbull-gym-' + code;
  // 1) sala del artefacto en claude.ai
  if (typeof window !== 'undefined' && window.claude?.use) {
    const room = await window.claude.use('room').catch(() => null);
    if (room) {
      const r = await room.join(name).catch(() => null);
      if (r) {
        const c = chunker(d => r.emit('gym', d).catch(() => {}), onMsg);
        const off = r.on('gym', (m) => { if (!m.sameTab) c.recv(m.data); });
        return { kind: 'room', send: c.send, close: () => { off(); r.leave().catch(() => {}); } };
      }
    }
  }
  // 2) canal en tiempo real de Supabase (la nube propia o la de Team Bull)
  const sb = await canalNube();
  if (sb) {
    const ch = sb.channel(name, { config: { broadcast: { self: false } } });
    const c = chunker(d => ch.send({ type: 'broadcast', event: 'gym', payload: d }), onMsg);
    ch.on('broadcast', { event: 'gym' }, ({ payload }) => c.recv(payload));
    const ok = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('No se pudo conectar con la nube.')), 10000);
      ch.subscribe((st) => { if (st === 'SUBSCRIBED') { clearTimeout(t); resolve(true); } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(t); reject(new Error('No se pudo conectar con la nube.')); } });
    }).catch((err) => {
      // dentro de Team Bull, sin conexión: sigue entre pestañas de este aparato (la pantalla avisa)
      if (sb === _tbSb) { sb.removeChannel(ch); return false; }
      throw err;
    });
    if (ok) return { kind: 'cloud', send: c.send, close: () => { sb.removeChannel(ch); } };
  }
  // 3) mismo dispositivo
  if (typeof BroadcastChannel !== 'undefined') {
    const bc = new BroadcastChannel(name);
    const c = chunker(d => bc.postMessage(d), onMsg);
    bc.onmessage = (e) => c.recv(e.data);
    return { kind: 'local', send: c.send, close: () => bc.close() };
  }
  throw new Error('Este navegador no puede conectar dos pantallas.');
}
