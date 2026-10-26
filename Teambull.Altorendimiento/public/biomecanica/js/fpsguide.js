// A cuántos cuadros por segundo filmar según lo que se mide. Cada marca (el inicio o el fin de algo) cae en
// un cuadro, y el instante real puede estar hasta medio cuadro antes o después: con F cuadros por segundo,
// ±500/F ms por marca. Las recomendaciones salen de ese margen frente a lo que dura lo que se mide.
const G = 9.81;
export const halfFrameMs = (fps) => 500 / fps;
// margen al 95 % de un salto de 0,5 s de vuelo (unos 30 cm), con ±½ cuadro uniforme en cada marca (como en gym.js)
export const jumpErrCm = (fps) => 100 * 1.96 * G * 0.5 * ((1 / fps) / Math.sqrt(6)) / 4;

const f0 = (v) => Math.round(v).toLocaleString('es-AR');
const f1 = (v) => v.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const GUIDE = {
  tech: { rec: 60, min: 50, what: 'Técnica de nado (ángulos, ciclos y fases)',
    why: () => `una fase de la brazada dura décimas de segundo: a 60 cada marca tiene ${f0(halfFrameMs(60))} ms de error; a 30, ${f0(halfFrameMs(30))} ms de error` },
  start: { rec: 240, min: 120, what: 'Salidas, vuelo y virajes',
    why: () => `todo pasa en décimas de segundo: a 120 cada marca tiene ${f0(halfFrameMs(120))} ms de error; a 30, ${f0(halfFrameMs(30))} ms de error. Usá la cámara lenta del celular` },
  race: { rec: 60, min: 50, what: 'Prueba completa (parciales, velocidad, frecuencia)',
    why: () => `los parciales se dan en centésimas: a 60 cada marca tiene ${f0(halfFrameMs(60))} ms de error; a 30, ${f0(halfFrameMs(30))} ms de error` },
  live: { rec: 60, min: 30, what: 'En la pileta (cámara en vivo)',
    why: () => 'el retraso y la grabación usan la cámara del dispositivo, así que elegí 60 en Calidad si el equipo lo permite' },
  bar: { rec: 60, min: 50, what: 'Gym: velocidad de la barra',
    why: () => `cada punta de la subida cae en un cuadro: a 60 son ${f0(halfFrameMs(60))} ms de error; a 30, ${f0(halfFrameMs(30))} ms de error y la velocidad de las subidas rápidas puede leerse un poco baja` },
  jump: { rec: 240, min: 120, what: 'Gym: saltos (tiempo de vuelo)',
    why: () => `en un salto de 30 cm, a 240 la altura puede errar hasta ${f1(jumpErrCm(240))} cm de más o de menos; a 120, hasta ${f1(jumpErrCm(120))} cm; a 30, hasta ${f1(jumpErrCm(30))} cm. Usá la cámara lenta del celular` },
};

// Frase corta para poner al lado de donde se elige el video.
export function fpsHint(kind) {
  const g = GUIDE[kind];
  return `Filmá a ${g.rec} cuadros por segundo${g.min < g.rec ? ` (mínimo ${g.min})` : ''}: ${g.why()}.`;
}

// Qué tal está el video que se cargó para lo que se quiere medir.
export function fpsVerdict(kind, fps) {
  const g = GUIDE[kind];
  if (!(fps > 0)) return { ok: null, text: '' };
  const ok = fps >= g.min * 0.97; // 59,94 o 119,88 cuentan como 60 y 120
  return {
    ok,
    text: ok
      ? `Este video tiene ${f0(fps)} cuadros por segundo: alcanza para ${g.what.toLowerCase()} (cada marca ${f0(halfFrameMs(fps))} ms de error).`
      : `Este video tiene ${f0(fps)} cuadros por segundo: para ${g.what.toLowerCase()} conviene ${g.rec} (mínimo ${g.min}). Se puede analizar igual, con márgenes más grandes (cada marca ${f0(halfFrameMs(fps))} ms de error).`,
  };
}

// Tabla con todas las opciones de la app.
export function fpsTable() {
  return `<ul class="fps-list">${Object.values(GUIDE).map(g => `<li><span>${g.what}</span><span class="fps-n"><b>${g.rec}</b>${g.min < g.rec ? ` <small>mínimo ${g.min}</small>` : ''}</span></li>`).join('')}</ul>
    <p class="fine">Cada marca cae en un cuadro y el instante real puede estar hasta medio cuadro antes o después: a 30 cuadros por segundo son ${f0(halfFrameMs(30))} ms de error, a 60 ${f0(halfFrameMs(60))} ms de error, a 120 ${f0(halfFrameMs(120))} ms de error y a 240 ${f0(halfFrameMs(240))} ms de error. Cuanto más corto es lo que medís, más cuadros hacen falta.</p>`;
}
