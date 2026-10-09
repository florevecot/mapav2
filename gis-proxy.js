// ======================================================
// functions/api/gis-proxy.js
// Intermediario para servicios GIS públicos (SEC, SUBTEL).
// El navegador no siempre puede consultarlos directo (CORS); esta función
// lo hace desde Cloudflare. Queda detrás de Cloudflare Access.
//
// Uso: /api/gis-proxy?url=<URL completa del servicio ArcGIS REST>
// ======================================================

// Servidores permitidos. Para agregar otro sin tocar el código, crea en
// Cloudflare la variable de entorno GIS_HOSTS con dominios separados por coma.
const HOSTS_BASE = ["apps.sec.cl", "licancabur.subtel.gob.cl", "services.arcgisonline.com"];
const HOST_ARCGIS_ONLINE = /^services\d*\.arcgis\.com$/i;

// Operaciones de solo lectura permitidas
const OPERACIONES = /\/(MapServer|FeatureServer)(\/\d+)?(\/(query|identify|legend|export))?$/i;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function error(msg, status) {
  return new Response(JSON.stringify({ error: { message: msg } }), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return error("Use GET", 405);

  // Solo desde el propio mapa
  const sitio = request.headers.get("Sec-Fetch-Site");
  if (sitio && sitio !== "same-origin" && sitio !== "none") return error("Origen no permitido", 403);

  const destino = new URL(request.url).searchParams.get("url") || "";
  let t;
  try { t = new URL(destino); } catch (_) { return error("URL inválida", 400); }
  if (t.protocol !== "https:") return error("Solo se permite https", 400);

  const extra = String(env?.GIS_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const host = t.hostname.toLowerCase();
  if (!HOSTS_BASE.includes(host) && !extra.includes(host) && !HOST_ARCGIS_ONLINE.test(host)) {
    return error(`Servidor no permitido: ${host}`, 403);
  }
  if (!/\/rest\/services\//i.test(t.pathname) || !OPERACIONES.test(t.pathname)) {
    return error("Operación no permitida", 403);
  }

  try {
    const resp = await fetch(t.toString(), {
      headers: { "User-Agent": UA, "Referer": `${t.origin}/`, "Accept": "*/*" },
      cf: { cacheTtl: 300, cacheEverything: true }
    });
    const headers = new Headers();
    headers.set("Content-Type", resp.headers.get("Content-Type") || "application/octet-stream");
    headers.set("Cache-Control", "private, max-age=300");
    return new Response(resp.body, { status: resp.status, headers });
  } catch (err) {
    return error("No se pudo contactar el servicio: " + err.message, 502);
  }
}
