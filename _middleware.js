// ======================================================
// functions/_middleware.js – Segunda capa de seguridad
//
// Cloudflare Access ya pide inicio de sesión antes de llegar al sitio.
// Este archivo vuelve a comprobar, en CADA petición (páginas, datos y API),
// que la visita trae un pase de Access válido y firmado por Cloudflare.
// Así, si Access quedara mal configurado o alguien entrara por una URL de
// vista previa no protegida, igual no vería nada.
//
// Se activa al definir en Cloudflare (Settings → Variables and Secrets):
//   ACCESS_TEAM_DOMAIN  ej. "ooee-wom"  (o "ooee-wom.cloudflareaccess.com")
//   ACCESS_AUD          el "Application Audience (AUD) Tag" de la app en Zero Trust
// Si no están definidas, el sitio funciona igual que antes (solo con Access).
// ======================================================

let certsCache = { url: "", keys: [], expira: 0 };

function b64urlABytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlATexto = (s) => new TextDecoder().decode(b64urlABytes(s));

function dominioEquipo(v) {
  const d = String(v || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return d.includes(".") ? d : `${d}.cloudflareaccess.com`;
}

async function obtenerCerts(equipo) {
  const url = `https://${equipo}/cdn-cgi/access/certs`;
  if (certsCache.url === url && Date.now() < certsCache.expira) return certsCache.keys;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudieron leer los certificados de Access (${r.status})`);
  const d = await r.json();
  certsCache = { url, keys: d.keys || [], expira: Date.now() + 60 * 60 * 1000 };
  return certsCache.keys;
}

async function verificarJWT(token, equipo, aud) {
  const partes = token.split(".");
  if (partes.length !== 3) throw new Error("Token mal formado");
  const cab = JSON.parse(b64urlATexto(partes[0]));
  const datos = JSON.parse(b64urlATexto(partes[1]));
  if (cab.alg !== "RS256") throw new Error("Algoritmo no permitido");

  let keys = await obtenerCerts(equipo);
  let jwk = keys.find((k) => k.kid === cab.kid);
  if (!jwk) { certsCache.expira = 0; keys = await obtenerCerts(equipo); jwk = keys.find((k) => k.kid === cab.kid); }
  if (!jwk) throw new Error("Llave desconocida");

  const llave = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", llave, b64urlABytes(partes[2]),
    new TextEncoder().encode(`${partes[0]}.${partes[1]}`));
  if (!ok) throw new Error("Firma inválida");

  const ahora = Math.floor(Date.now() / 1000);
  if (datos.exp && datos.exp < ahora - 30) throw new Error("Sesión vencida");
  if (datos.nbf && datos.nbf > ahora + 30) throw new Error("Token aún no válido");
  if (datos.iss && datos.iss !== `https://${equipo}`) throw new Error("Emisor inválido");
  const auds = Array.isArray(datos.aud) ? datos.aud : [datos.aud];
  if (!auds.includes(aud)) throw new Error("Token de otra aplicación");
  return datos;
}

function denegar(msg) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Acceso restringido</title>
     <body style="font-family:system-ui;padding:40px;max-width:560px">
     <h2>🔒 Acceso restringido</h2><p>${msg}</p>
     <p>Abre el mapa desde su dirección oficial e inicia sesión con tu correo autorizado.</p></body>`,
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const equipo = env.ACCESS_TEAM_DOMAIN ? dominioEquipo(env.ACCESS_TEAM_DOMAIN) : "";
  const aud = String(env.ACCESS_AUD || "").trim();
  data.email = "";
  data.accesoVerificado = false;

  if (equipo && aud) {
    const token = request.headers.get("Cf-Access-Jwt-Assertion") ||
      (request.headers.get("Cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1] || "";
    if (!token) return denegar("No se encontró una sesión de Cloudflare Access.");
    try {
      const datos = await verificarJWT(token, equipo, aud);
      data.email = String(datos.email || "").toLowerCase();
      data.accesoVerificado = true;
    } catch (err) {
      return denegar(`No se pudo verificar tu sesión (${err.message}).`);
    }
  }

  const resp = await next();
  return resp;
}
