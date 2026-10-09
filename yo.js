// GET /api/yo – quién soy y si puedo actualizar datos (lo usa la interfaz)
import { esAdmin } from "../../lib/admin.js";

export async function onRequestGet({ env, data }) {
  return new Response(JSON.stringify({
    email: data.email || "",
    accesoVerificado: !!data.accesoVerificado,
    admin: esAdmin(env, data),
    publicacionConfigurada: !!(env.GITHUB_TOKEN && env.GITHUB_REPO)
  }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
