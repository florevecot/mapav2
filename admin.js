// Utilidades compartidas: quién es administrador.
// ADMIN_EMAILS (variable en Cloudflare): correos separados por coma, ej.
//   "florencia@wom.cl, otra.persona@wom.cl"
// Solo cuenta si el correo viene verificado por el middleware (firma de Access).
export function esAdmin(env, data) {
  if (!data?.accesoVerificado || !data.email) return false;
  const lista = String(env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return lista.includes(data.email.toLowerCase());
}

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
