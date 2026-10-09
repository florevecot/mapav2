// ======================================================
// functions/api/sii-proxy.js
// Proxy del SII como Cloudflare Pages Function.
// Queda publicado en /api/sii-proxy del mismo sitio y protegido por
// Cloudflare Access igual que el resto del mapa.
// ======================================================

const ENDPOINTS_VALIDOS = new Set(["getFeatureInfo", "getPredioNacional", "getServicioPredio"]);
const SII_BASE = "https://www4.sii.cl/mapasui";
const MAX_BODY = 20000; // bytes
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// La cookie de sesión del SII se reutiliza unos minutos para no pedirla en cada consulta
let siiCookie = null;
let cookieExpira = 0;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function obtenerCookieSII() {
  if (siiCookie && Date.now() < cookieExpira) return siiCookie;
  try {
    const resp = await fetch(`${SII_BASE}/internet/`, {
      headers: { "User-Agent": UA, "Accept": "text/html,*/*;q=0.8", "Accept-Language": "es-CL,es;q=0.9" }
    });
    const cookies = typeof resp.headers.getSetCookie === "function"
      ? resp.headers.getSetCookie()
      : [resp.headers.get("set-cookie") || ""];
    for (const c of cookies) {
      const m = c.match(/(TS[a-z0-9]+=[^;\s]+)/i);
      if (m) {
        siiCookie = m[1];
        cookieExpira = Date.now() + 10 * 60 * 1000;
        break;
      }
    }
  } catch (err) {
    console.warn("No se pudo obtener cookie SII:", err.message);
  }
  return siiCookie;
}

async function manejarPost(request) {
  const url = new URL(request.url);

  // Solo se aceptan llamadas desde el propio mapa (no desde otros sitios)
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "Origen no permitido" }, 403);

  const endpoint = url.searchParams.get("endpoint") || "";
  if (!ENDPOINTS_VALIDOS.has(endpoint)) return json({ error: "Endpoint no permitido" }, 400);

  const texto = await request.text();
  if (texto.length > MAX_BODY) return json({ error: "Solicitud demasiado grande" }, 413);
  let data;
  try { data = JSON.parse(texto || "{}"); } catch (_) { return json({ error: "JSON inválido" }, 400); }

  const cookie = await obtenerCookieSII();
  const payload = {
    metaData: {
      namespace: `cl.sii.sdi.lob.bbrr.mapas.data.api.interfaces.MapasFacadeService/${endpoint}`,
      conversationId: "UNAUTHENTICATED-CALL",
      transactionId: crypto.randomUUID()
    },
    data
  };
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Referer": `${SII_BASE}/internet/`,
    "Origin": "https://www4.sii.cl",
    "User-Agent": UA,
    "Accept-Language": "es-CL,es;q=0.9",
    "X-Requested-With": "XMLHttpRequest"
  };
  if (cookie) headers["Cookie"] = cookie;

  try {
    const resp = await fetch(`${SII_BASE}/services/data/mapasFacadeService/${endpoint}`, {
      method: "POST", headers, body: JSON.stringify(payload)
    });
    const tipo = resp.headers.get("content-type") || "";
    if (!tipo.includes("json")) {
      siiCookie = null; // la sesión expiró: se pedirá una nueva en la próxima consulta
      return json({ error: "El SII no devolvió datos (sesión inválida o servicio caído)" }, 502);
    }
    return json(await resp.json(), resp.ok ? 200 : 502);
  } catch (err) {
    return json({ error: "Error al consultar SII", detalle: err.message }, 502);
  }
}

export async function onRequest({ request }) {
  if (request.method === "POST") return manejarPost(request);
  return json({ error: "Use POST" }, 405);
}
