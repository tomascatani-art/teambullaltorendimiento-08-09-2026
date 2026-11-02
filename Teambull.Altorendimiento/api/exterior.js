// Función serverless: calendario de CADDA.
// Desde el navegador no se puede leer la página de CADDA directo, así que la app le pregunta a
// esta función y esta función lee la página pública y devuelve solo los datos.
//   /api/exterior?cadda=1                  próximos torneos del calendario de CADDA

const CADDA = "https://cadda.org.ar/wp-json/tribe/events/v1/events";
const CABECERAS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
};

function responder(res, status, cuerpo, cacheSeg = 0) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", cacheSeg ? `s-maxage=${cacheSeg}, stale-while-revalidate=${cacheSeg}` : "no-store");
  res.end(JSON.stringify(cuerpo));
}

// ---------- HTML → texto ----------
const ENTIDADES = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", ndash: "–", mdash: "—", ntilde: "ñ", Ntilde: "Ñ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç", atilde: "ã", otilde: "õ" };
function limpiar(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- CADDA ----------
async function calendarioCadda() {
  const hoy = new Date().toISOString().slice(0, 10);
  let url = `${CADDA}?start_date=${hoy}&per_page=50`;
  const eventos = [];
  for (let i = 0; i < 4 && url; i++) {
    const r = await fetch(url, { headers: { ...CABECERAS, Accept: "application/json" } });
    if (!r.ok) break;
    const d = await r.json();
    eventos.push(...(d.events || []));
    url = d.next_rest_url || null;
  }
  return eventos
    .map((e) => {
      const titulo = limpiar(e.title);
      const cats = (e.categories || []).map((c) => c.name).join(" ");
      return { e, titulo, cats };
    })
    .filter(({ titulo, cats }) => /nataci[oó]n|aguas abiertas/i.test(`${titulo} ${cats}`) && !/art[ií]stic|polo|clavados|master/i.test(`${titulo} ${cats}`))
    .map(({ e, titulo }) => {
      const v = e.venue && !Array.isArray(e.venue) ? e.venue : {};
      return {
        id: `cadda-${e.id}`,
        name: titulo.replace(/\s*[–-]\s*Nataci[oó]n\s*$/i, ""),
        start_date: String(e.start_date || "").slice(0, 10),
        end_date: String(e.end_date || "").slice(0, 10),
        location: [v.venue, v.city, v.country].filter(Boolean).join(", "),
        categoria: limpiar(e.excerpt || e.description || "").slice(0, 80),
        abiertas: /aguas abiertas/i.test(titulo),
        url: e.url || "",
      };
    })
    .filter((e) => e.start_date);
}

export default async function handler(req, res) {
  const q = req.query || {};
  try {
    if (q.cadda) return responder(res, 200, { eventos: await calendarioCadda() }, 6 * 3600);
    return responder(res, 400, { error: "Falta cadda." });
  } catch (e) {
    return responder(res, 502, { error: e.message || "No se pudo conectar." });
  }
}
