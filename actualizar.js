// ======================================================
// functions/api/actualizar.js – Publica datos nuevos en GitHub
//
// Lo usa la página actualizar.html. Solo administradores (ADMIN_EMAILS) y
// solo puede escribir DOS archivos fijos: assets/mapa_inventario.json,
// assets/sigma_mapa.json (y assets/datos_meta.json con fecha y autor).
// Nunca puede tocar el código del sitio.
//
// Variables en Cloudflare (Settings → Variables and Secrets):
//   GITHUB_TOKEN   (Secret) token "fine-grained" con permiso Contents: Read and write
//                  SOLO sobre el repositorio del mapa
//   GITHUB_REPO    ej. "florevecot/mapa-ooee"
//   GITHUB_BRANCH  opcional, por defecto "main"
//
// Flujo (para no exceder los límites de CPU del plan gratis, el archivo
// grande se transmite a GitHub sin procesarlo):
//   POST ?paso=blob    cuerpo = {"content":"<base64>","encoding":"base64"} → { sha }
//   POST ?paso=commit  cuerpo = { blobs: {inventario, grafo, meta}, mensaje } → { commit }
// ======================================================
import { esAdmin, json } from "../../lib/admin.js";

const RUTAS = {
  inventario: "assets/mapa_inventario.json",
  grafo: "assets/sigma_mapa.json",
  meta: "assets/datos_meta.json"
};
const MAX_BLOB = 40 * 1024 * 1024; // 40 MB en base64 (~30 MB de archivo)

function gh(env, ruta, init = {}) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${ruta}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mapa-ooee",
      ...(init.headers || {})
    }
  });
}

async function ghJSON(env, ruta, init) {
  const r = await gh(env, ruta, init);
  const t = await r.text();
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

export async function onRequestPost({ request, env, data }) {
  if (!esAdmin(env, data)) return json({ error: "Solo administradores pueden publicar datos" }, 403);
  if (!env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO || "")) {
    return json({ error: "Falta configurar GITHUB_TOKEN y GITHUB_REPO en Cloudflare" }, 500);
  }
  const origen = request.headers.get("Origin");
  if (origen && origen !== new URL(request.url).origin) return json({ error: "Origen no permitido" }, 403);

  const paso = new URL(request.url).searchParams.get("paso");
  const rama = env.GITHUB_BRANCH || "main";

  try {
    if (paso === "blob") {
      const largo = parseInt(request.headers.get("Content-Length") || "0", 10);
      if (!largo || largo > MAX_BLOB) return json({ error: "Archivo vacío o demasiado grande" }, 413);
      // Se reenvía el cuerpo tal cual (sin leerlo) para no gastar CPU
      let cuerpo = request.body;
      if (typeof FixedLengthStream === "function") {
        const { readable, writable } = new FixedLengthStream(largo);
        request.body.pipeTo(writable);
        cuerpo = readable;
      }
      const r = await gh(env, "/git/blobs", { method: "POST", body: cuerpo, headers: { "Content-Type": "application/json" } });
      const t = await r.text();
      if (!r.ok) throw new Error(`GitHub ${r.status}: ${t.slice(0, 200)}`);
      return json({ sha: JSON.parse(t).sha });
    }

    if (paso === "commit") {
      const body = await request.json();
      const blobs = body?.blobs || {};
      const arbol = Object.entries(RUTAS)
        .filter(([k]) => /^[0-9a-f]{40}$/.test(blobs[k] || ""))
        .map(([k, path]) => ({ path, mode: "100644", type: "blob", sha: blobs[k] }));
      if (!arbol.some((x) => x.path === RUTAS.inventario)) return json({ error: "Falta el inventario" }, 400);

      const ref = await ghJSON(env, `/git/ref/heads/${rama}`);
      const padre = await ghJSON(env, `/git/commits/${ref.object.sha}`);
      const tree = await ghJSON(env, "/git/trees", {
        method: "POST", body: JSON.stringify({ base_tree: padre.tree.sha, tree: arbol })
      });
      const mensaje = String(body.mensaje || "Actualización de datos").slice(0, 200);
      const commit = await ghJSON(env, "/git/commits", {
        method: "POST",
        body: JSON.stringify({ message: `${mensaje}\n\nPublicado desde el mapa por ${data.email}`, tree: tree.sha, parents: [ref.object.sha] })
      });
      await ghJSON(env, `/git/refs/heads/${rama}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
      return json({ commit: commit.sha, url: commit.html_url || "" });
    }

    return json({ error: "Paso desconocido" }, 400);
  } catch (err) {
    return json({ error: err.message }, 502);
  }
}

export function onRequest() { return json({ error: "Use POST" }, 405); }
