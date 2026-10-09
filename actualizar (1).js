// ======================================================
// actualizar.js – Página para actualizar la base de datos del mapa
//
// 1. Lee un Excel / CSV / JSON en el navegador (los datos no salen del
//    computador hasta que presionas "Publicar").
// 2. Valida, compara con lo publicado y deja elegir qué columnas subir.
// 3. Genera assets/mapa_inventario.json, assets/sigma_mapa.json y
//    assets/datos_meta.json y los publica en GitHub (vía /api/actualizar)
//    o los descarga para subirlos a mano.
// ======================================================

(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
  const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
  const fmt = (n) => Number(n).toLocaleString("es-CL");

  // ---------- Reglas ----------
  const OBLIGATORIAS = ["Nemonico", "Lat", "Long", "Estado OOEE"];
  const COL_PADRE = "Dependencia de sitio atras(Torre Padre)";
  // Columnas para el grafo
  const CAMPOS_NODO = ["Nemonico", "Nombre Sitio", "Comuna", "Lat", "Long", "Estatus OOEE NF"];
  // Nombres alternativos que se aceptan en el Excel
  const ALIAS = {
    "NEMONICO": "Nemonico", "NEMOTECNICO": "Nemonico", "ID SITIO": "Nemonico",
    "LAT": "Lat", "LATITUD": "Lat", "LATITUDE": "Lat",
    "LONG": "Long", "LON": "Long", "LNG": "Long", "LONGITUD": "Long", "LONGITUDE": "Long"
  };
  // Columnas que por defecto NO se publican (datos de clientes o personas)
  const SENSIBLE = /medidor|cliente|suministro|contacto|rut\b|telefono|tel[eé]fono|correo|e-?mail|bitacora|comentario/i;
  // Límites aproximados de Chile continental + insular (Isla de Pascua, Juan Fernández)
  const CHILE = { latMin: -56.5, latMax: -17, lonMin: -110, lonMax: -66 };
  const LIMITE_ARCHIVO = 24 * 1024 * 1024; // Cloudflare Pages acepta archivos de hasta 25 MiB
  const CLAVE_COLUMNAS = "actualizar.columnas";

  // ---------- Estado ----------
  let actualInv = [];
  let actualGrafo = { nodes: [], edges: [] };
  let libro = null;            // libro Excel (SheetJS)
  let nombreArchivo = "";
  let filas = [];              // filas nuevas ya normalizadas (todas las columnas)
  let columnas = [];           // encabezados en orden
  let conexionesHoja = null;   // [{from,to}] desde la hoja de conexiones
  let resultado = null;        // { inventario, grafo, meta, textos }
  let yo = { admin: false, publicacionConfigurada: false, email: "" };

  // ====================================================
  // INICIO
  // ====================================================
  async function iniciar() {
    try {
      const r = await fetch("./api/yo", { cache: "no-store" });
      if (r.ok) yo = await r.json();
    } catch (_) {}
    $("quien").textContent = yo.email
      ? `${yo.email} · ${yo.admin ? "administrador ✅" : "sin permiso para publicar (puedes revisar y descargar)"}`
      : "Sesión no verificada: puedes revisar y descargar, pero no publicar.";

    try {
      const [inv, grafo, meta] = await Promise.all([
        fetch("./assets/mapa_inventario.json", { cache: "no-store" }).then((r) => r.json()),
        fetch("./assets/sigma_mapa.json", { cache: "no-store" }).then((r) => r.json()),
        fetch("./assets/datos_meta.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]);
      actualInv = Array.isArray(inv) ? inv : [];
      actualGrafo = grafo && Array.isArray(grafo.nodes) ? grafo : { nodes: [], edges: [] };
      $("actual").innerHTML = `Publicado hoy: <b>${fmt(actualInv.length)}</b> sitios y <b>${fmt(actualGrafo.edges.length)}</b> conexiones` +
        (meta ? ` · última actualización <b>${esc(new Date(meta.fecha).toLocaleString("es-CL"))}</b>${meta.autor ? ` por ${esc(meta.autor)}` : ""}` : "") + ".";
    } catch (err) {
      $("actual").textContent = "No se pudieron leer los datos publicados (" + err.message + "). Igual puedes cargar un archivo nuevo.";
    }

    const drop = $("drop");
    $("archivo").addEventListener("change", (e) => e.target.files[0] && leerArchivo(e.target.files[0]));
    ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("sobre"); }));
    ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("sobre"); }));
    drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && leerArchivo(e.dataTransfer.files[0]));
    $("hojaInventario").addEventListener("change", () => procesarHojas());
    $("hojaConexiones").addEventListener("change", () => procesarHojas());
    $("colTodas").addEventListener("click", () => marcarColumnas(() => true));
    $("colSensibles").addEventListener("click", () => marcarColumnas((c) => !SENSIBLE.test(c)));
    $("publicar").addEventListener("click", publicar);
    $("descargar").addEventListener("click", descargar);
    $("confirmarBaja").addEventListener("change", actualizarBotones);
  }

  // ====================================================
  // LECTURA DEL ARCHIVO
  // ====================================================
  async function leerArchivo(file) {
    nombreArchivo = file.name;
    libro = null;
    conexionesHoja = null;
    $("drop").querySelector("span").textContent = `📄 ${file.name} — leyendo…`;
    try {
      if (/\.json$/i.test(file.name)) {
        const d = JSON.parse(await file.text());
        const arr = Array.isArray(d) ? d : (Array.isArray(d?.nodes) ? d.nodes : null);
        if (!arr) throw new Error("El JSON debe ser un arreglo de sitios");
        $("hojas").classList.add("hidden");
        cargarFilas(arr.map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v]))));
      } else {
        if (typeof XLSX === "undefined") throw new Error("No cargó el lector de Excel (revisa tu conexión)");
        libro = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        prepararSelectorHojas();
        procesarHojas();
      }
      $("drop").querySelector("span").textContent = `📄 ${file.name} — listo. Puedes elegir otro archivo.`;
    } catch (err) {
      console.error(err);
      $("drop").querySelector("span").textContent = `❌ ${file.name}: ${err.message}`;
    }
  }

  function filasDeHoja(nombre) {
    const hoja = libro.Sheets[nombre];
    const matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: "", dateNF: "dd-mm-yyyy" });
    return matriz;
  }

  function buscarEncabezado(matriz, candidatos) {
    for (let i = 0; i < Math.min(matriz.length, 15); i++) {
      const fila = matriz[i].map((c) => normalizar(c));
      if (candidatos.some((c) => fila.includes(c))) return i;
    }
    return -1;
  }

  function prepararSelectorHojas() {
    const nombres = libro.SheetNames;
    const selInv = $("hojaInventario"), selCon = $("hojaConexiones");
    selInv.innerHTML = nombres.map((n) => `<option>${esc(n)}</option>`).join("");
    selCon.innerHTML = `<option value="">(ninguna)</option>` + nombres.map((n) => `<option>${esc(n)}</option>`).join("");
    // Detección automática
    let inv = nombres.find((n) => buscarEncabezado(filasDeHoja(n), ["NEMONICO", "ID SITIO"]) >= 0) || nombres[0];
    selInv.value = inv;
    const con = nombres.find((n) => n !== inv && buscarEncabezado(filasDeHoja(n), ["FROM", "ORIGEN", "DESDE", "HIJO"]) >= 0);
    selCon.value = con || "";
    $("hojas").classList.toggle("hidden", nombres.length < 2);
  }

  function procesarHojas() {
    // Inventario
    const matriz = filasDeHoja($("hojaInventario").value);
    const h = buscarEncabezado(matriz, ["NEMONICO", "ID SITIO", "NEMOTECNICO"]);
    if (h < 0) {
      mostrarSoloValidacion([{ tipo: "err", texto: `La hoja "${$("hojaInventario").value}" no tiene una columna Nemonico.` }]);
      return;
    }
    const cab = matriz[h].map((c) => String(c).trim());
    const objetos = matriz.slice(h + 1)
      .filter((f) => f.some((v) => String(v).trim() !== ""))
      .map((f) => Object.fromEntries(cab.map((c, i) => [c, f[i] ?? ""]).filter(([c]) => c)));

    // Conexiones
    conexionesHoja = null;
    const hc = $("hojaConexiones").value;
    if (hc) {
      const m = filasDeHoja(hc);
      const i = buscarEncabezado(m, ["FROM", "ORIGEN", "DESDE", "HIJO"]);
      if (i >= 0) {
        const c = m[i].map(normalizar);
        const iF = c.findIndex((x) => ["FROM", "ORIGEN", "DESDE", "HIJO"].includes(x));
        const iT = c.findIndex((x) => ["TO", "DESTINO", "HASTA", "PADRE"].includes(x));
        if (iF >= 0 && iT >= 0) {
          conexionesHoja = m.slice(i + 1).map((f) => ({ from: String(f[iF]).trim(), to: String(f[iT]).trim() }))
            .filter((e) => e.from && e.to);
        }
      }
    }
    cargarFilas(objetos);
  }

  // Normaliza nombres de columnas y valores
  function cargarFilas(objetos) {
    const vistos = new Map();
    filas = objetos.map((o) => {
      const r = {};
      for (const [k0, v0] of Object.entries(o)) {
        const k = ALIAS[normalizar(k0)] || String(k0).trim();
        if (!k) continue;
        let v = v0 instanceof Date ? v0.toLocaleDateString("es-CL") : (v0 === null || v0 === undefined ? "" : String(v0).trim());
        if (k === "Lat" || k === "Long") v = v.replace(",", ".");
        r[k] = v;
        if (!vistos.has(k)) vistos.set(k, true);
      }
      return r;
    });
    columnas = [...vistos.keys()];
    // Mantener el orden: Nemonico primero
    columnas.sort((a, b) => (a === "Nemonico" ? -1 : b === "Nemonico" ? 1 : 0));
    renderColumnas();
    renderOpcionesGrafo();
    calcular();
  }

  // ====================================================
  // COLUMNAS A PUBLICAR
  // ====================================================
  function leerPreferencias() {
    try { return JSON.parse(localStorage.getItem(CLAVE_COLUMNAS) || "{}") || {}; } catch (_) { return {}; }
  }
  function guardarPreferencias() {
    const p = leerPreferencias();
    document.querySelectorAll("#columnas input").forEach((cb) => { p[cb.value] = cb.checked; });
    try { localStorage.setItem(CLAVE_COLUMNAS, JSON.stringify(p)); } catch (_) {}
  }

  function renderColumnas() {
    const pref = leerPreferencias();
    const cont = $("columnas");
    cont.innerHTML = "";
    columnas.forEach((c) => {
      const obligatoria = OBLIGATORIAS.includes(c);
      const sensible = SENSIBLE.test(c);
      const label = document.createElement("label");
      label.className = (obligatoria ? "obligatoria " : "") + (sensible ? "sensible" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = c;
      cb.checked = obligatoria || (c in pref ? !!pref[c] : !sensible);
      cb.disabled = obligatoria;
      cb.addEventListener("change", () => { guardarPreferencias(); calcular(); });
      const span = document.createElement("span");
      span.textContent = c;
      label.append(cb, span);
      cont.appendChild(label);
    });
    $("paso3").classList.remove("hidden");
  }

  function marcarColumnas(fn) {
    document.querySelectorAll("#columnas input").forEach((cb) => { if (!cb.disabled) cb.checked = fn(cb.value); });
    guardarPreferencias();
    calcular();
  }

  const columnasElegidas = () => [...document.querySelectorAll("#columnas input")].filter((cb) => cb.checked).map((cb) => cb.value);

  // ====================================================
  // OPCIONES DEL GRAFO
  // ====================================================
  function renderOpcionesGrafo() {
    const tienePadre = columnas.includes(COL_PADRE);
    const ops = [];
    if (conexionesHoja) ops.push(["hoja", `Usar la hoja de conexiones del archivo (${fmt(conexionesHoja.length)} filas)`]);
    ops.push(["mantener", `Mantener las conexiones actuales sin cambios (${fmt(actualGrafo.edges.length)}); se quitan solo las de sitios que ya no existen`]);
    if (tienePadre) {
      ops.push(["mantenerPadre", "Mantener las actuales y agregar las que indique la columna “Torre Padre”"]);
      ops.push(["padre", "Reconstruir solo desde la columna “Torre Padre”"]);
    }
    $("opcionesGrafo").innerHTML = ops.map(([v, t], i) =>
      `<label><input type="radio" name="grafo" value="${v}" ${i === 0 ? "checked" : ""}><span>${esc(t)}</span></label>`).join("");
    $("opcionesGrafo").querySelectorAll("input").forEach((r) => r.addEventListener("change", calcular));
    $("paso4").classList.remove("hidden");
  }

  function construirGrafo(inventario) {
    const modo = document.querySelector('input[name="grafo"]:checked')?.value || "mantener";
    const ids = new Set(inventario.map((r) => r.Nemonico));
    const aristas = new Map();
    let descartadas = 0;
    const agregar = (a, b) => {
      a = String(a || "").trim(); b = String(b || "").trim();
      if (!a || !b || a === b) return;
      if (!ids.has(a) || !ids.has(b)) { descartadas++; return; }
      const k = `${a}\u0000${b}`, k2 = `${b}\u0000${a}`;
      if (!aristas.has(k) && !aristas.has(k2)) aristas.set(k, { from: a, to: b });
    };
    if (modo === "hoja") conexionesHoja.forEach((e) => agregar(e.from, e.to));
    if (modo === "mantener" || modo === "mantenerPadre") actualGrafo.edges.forEach((e) => agregar(e.from ?? e.source, e.to ?? e.target));
    if (modo === "mantenerPadre" || modo === "padre") filas.forEach((r) => agregar(r.Nemonico, r[COL_PADRE]));

    const nodos = inventario.map((r) => Object.fromEntries(CAMPOS_NODO.map((c) => [c, r[c] ?? ""])));
    return { grafo: { nodes: nodos, edges: [...aristas.values()] }, descartadas, modo };
  }

  // ====================================================
  // VALIDACIÓN Y COMPARACIÓN
  // ====================================================
  function calcular() {
    if (!filas.length) return;
    const msgs = [];
    const faltan = OBLIGATORIAS.filter((c) => !columnas.includes(c));
    if (faltan.length) {
      mostrarSoloValidacion([{ tipo: "err", texto: `Faltan columnas obligatorias: <b>${faltan.map(esc).join(", ")}</b>. Revisa los encabezados del archivo.` }]);
      return;
    }

    const elegidas = columnasElegidas();
    const sinId = [], dup = [], sinCoord = [], fuera = [];
    const vistos = new Set();
    const inventario = [];
    filas.forEach((r, i) => {
      const id = String(r.Nemonico || "").trim();
      if (!id) { sinId.push(i + 2); return; }
      if (vistos.has(id)) dup.push(id);
      vistos.add(id);
      const lat = parseFloat(r.Lat), lon = parseFloat(r.Long);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) sinCoord.push(id);
      else if (lat < CHILE.latMin || lat > CHILE.latMax || lon < CHILE.lonMin || lon > CHILE.lonMax) fuera.push(`${id} (${lat}, ${lon})`);
      inventario.push(Object.fromEntries(elegidas.map((c) => [c, r[c] ?? ""])));
    });

    const lista = (arr) => `<details><summary>Ver ${fmt(arr.length)}</summary><div class="lista">${arr.slice(0, 300).map(esc).join("\n")}${arr.length > 300 ? "\n…" : ""}</div></details>`;
    if (sinId.length) msgs.push({ tipo: "warn", texto: `${fmt(sinId.length)} filas sin Nemonico (se omiten). Filas del Excel: ${sinId.slice(0, 15).join(", ")}${sinId.length > 15 ? "…" : ""}` });
    if (dup.length) msgs.push({ tipo: "warn", texto: `${fmt(dup.length)} nemónicos repetidos (se publican todos; en el mapa se usa el primero).` + lista([...new Set(dup)]) });
    if (sinCoord.length) msgs.push({ tipo: "warn", texto: `${fmt(sinCoord.length)} sitios sin coordenadas válidas (no aparecerán en el mapa).` + lista(sinCoord) });
    if (fuera.length) msgs.push({ tipo: "warn", texto: `${fmt(fuera.length)} sitios con coordenadas fuera de Chile (¿latitud y longitud invertidas o sin signo?).` + lista(fuera) });
    const ocultas = columnas.filter((c) => !elegidas.includes(c));
    if (ocultas.length) msgs.push({ tipo: "ok", texto: `🔒 ${fmt(ocultas.length)} columnas no se publicarán: ${ocultas.map(esc).join(", ")}` });

    const { grafo, descartadas, modo } = construirGrafo(inventario);
    $("resumenGrafo").textContent = `Resultado: ${fmt(grafo.edges.length)} conexiones` +
      (descartadas ? ` (${fmt(descartadas)} descartadas porque uno de los dos sitios no está en el inventario, o la columna trae textos como “N/A”).` : ".");

    // Comparación con lo publicado
    const antes = new Map(actualInv.map((r) => [r.Nemonico, r]));
    const ahora = new Map(inventario.map((r) => [r.Nemonico, r]));
    const nuevos = [...ahora.keys()].filter((k) => !antes.has(k));
    const eliminados = [...antes.keys()].filter((k) => !ahora.has(k));
    const cambiados = [];
    let cambiosEstado = 0;
    ahora.forEach((r, k) => {
      const a = antes.get(k);
      if (!a) return;
      const difs = elegidas.filter((c) => String(a[c] ?? "") !== String(r[c] ?? ""));
      if (difs.length) cambiados.push(`${k}: ${difs.slice(0, 4).join(", ")}${difs.length > 4 ? "…" : ""}`);
      if (String(a["Estado OOEE"] ?? "") !== String(r["Estado OOEE"] ?? "")) cambiosEstado++;
    });
    const baja = actualInv.length > 0 && inventario.length < actualInv.length * 0.8;
    if (baja) msgs.push({ tipo: "err", texto: `⚠️ El archivo nuevo tiene ${fmt(inventario.length)} sitios contra ${fmt(actualInv.length)} publicados (−${Math.round((1 - inventario.length / actualInv.length) * 100)}%). ¿Es el archivo completo?` });

    // Archivos finales
    const meta = {
      fecha: new Date().toISOString(),
      autor: yo.email || "",
      archivo: nombreArchivo,
      sitios: inventario.length,
      conexiones: grafo.edges.length,
      columnasPublicadas: elegidas
    };
    const textos = {
      inventario: JSON.stringify(inventario),
      grafo: JSON.stringify(grafo),
      meta: JSON.stringify(meta, null, 2)
    };
    const peso = new Blob([textos.inventario]).size;
    if (peso > LIMITE_ARCHIVO) msgs.push({ tipo: "err", texto: `El inventario pesa ${(peso / 1048576).toFixed(1)} MB y el máximo es 25 MB. Desmarca columnas que no se usen.` });
    else msgs.unshift({ tipo: "ok", texto: `✅ ${fmt(inventario.length)} sitios listos · inventario ${(peso / 1048576).toFixed(1)} MB · grafo ${(new Blob([textos.grafo]).size / 1048576).toFixed(1)} MB` });

    resultado = { inventario, grafo, meta, textos, bloqueado: peso > LIMITE_ARCHIVO, baja, modo };

    $("validacion").innerHTML = msgs.map((m) => `<div class="msg ${m.tipo}">${m.texto}</div>`).join("");
    $("diferencias").innerHTML = `
      <div class="cifras">
        <div class="cifra"><b>${fmt(nuevos.length)}</b><span>sitios nuevos</span></div>
        <div class="cifra"><b>${fmt(eliminados.length)}</b><span>sitios que salen</span></div>
        <div class="cifra"><b>${fmt(cambiados.length)}</b><span>sitios con cambios</span></div>
        <div class="cifra"><b>${fmt(cambiosEstado)}</b><span>cambios de Estado OOEE</span></div>
      </div>
      ${nuevos.length ? `<div class="msg ok">Nuevos ${lista(nuevos)}</div>` : ""}
      ${eliminados.length ? `<div class="msg warn">Salen del mapa ${lista(eliminados)}</div>` : ""}
      ${cambiados.length ? `<div class="msg ok">Con cambios ${lista(cambiados)}</div>` : ""}`;

    $("paso5").classList.remove("hidden");
    $("paso6").classList.remove("hidden");
    $("confirmarBajaBox").classList.toggle("hidden", !baja);
    if (!$("mensaje").value) $("mensaje").value = `Actualización de datos ${new Date().toLocaleDateString("es-CL")}`;
    actualizarBotones();
  }

  function mostrarSoloValidacion(msgs) {
    resultado = null;
    $("paso5").classList.remove("hidden");
    $("paso6").classList.add("hidden");
    $("validacion").innerHTML = msgs.map((m) => `<div class="msg ${m.tipo}">${m.texto}</div>`).join("");
    $("diferencias").innerHTML = "";
  }

  function actualizarBotones() {
    const okDatos = resultado && !resultado.bloqueado && (!resultado.baja || $("confirmarBaja").checked);
    $("descargar").disabled = !resultado || resultado.bloqueado;
    $("publicar").disabled = !okDatos || !yo.admin || !yo.publicacionConfigurada;
    $("estadoPublicar").textContent = !yo.admin
      ? "Para publicar directo necesitas ser administrador. Puedes descargar los archivos y subirlos a GitHub."
      : !yo.publicacionConfigurada
        ? "La publicación directa aún no está configurada en Cloudflare (GITHUB_TOKEN y GITHUB_REPO). Usa la descarga."
        : "";
  }

  // ====================================================
  // PUBLICAR / DESCARGAR
  // ====================================================
  function aBase64(texto) {
    const bytes = new TextEncoder().encode(texto);
    const partes = [];
    const PASO = 0x6000; // múltiplo de 3
    for (let i = 0; i < bytes.length; i += PASO) {
      partes.push(btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + PASO))));
    }
    return partes.join("");
  }

  function paso(texto) {
    const li = document.createElement("li");
    li.textContent = texto;
    $("progreso").appendChild(li);
    return li;
  }

  async function subirBlob(nombre, texto) {
    const li = paso(`Subiendo ${nombre}…`);
    const cuerpo = new Blob(['{"encoding":"base64","content":"', aBase64(texto), '"}'], { type: "application/json" });
    const r = await fetch("./api/actualizar?paso=blob", { method: "POST", body: cuerpo, headers: { "Content-Type": "application/json" } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    li.textContent = `✅ ${nombre} subido`;
    return d.sha;
  }

  async function publicar() {
    if (!resultado) return;
    if (!confirm(`Se publicarán ${fmt(resultado.inventario.length)} sitios y ${fmt(resultado.grafo.edges.length)} conexiones. ¿Continuar?`)) return;
    $("publicar").disabled = true;
    $("progreso").innerHTML = "";
    $("estadoPublicar").textContent = "Publicando… no cierres esta página.";
    try {
      const blobs = {
        inventario: await subirBlob("inventario", resultado.textos.inventario),
        grafo: await subirBlob("conexiones", resultado.textos.grafo),
        meta: await subirBlob("datos de la versión", resultado.textos.meta)
      };
      const li = paso("Guardando la nueva versión en GitHub…");
      const r = await fetch("./api/actualizar?paso=commit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobs, mensaje: $("mensaje").value.trim() })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      li.textContent = `✅ Versión guardada (${d.commit.slice(0, 7)})`;
      $("estadoPublicar").innerHTML = `🎉 Listo. Cloudflare publicará el cambio en 1–2 minutos. Después recarga el mapa.`;
    } catch (err) {
      console.error(err);
      $("estadoPublicar").textContent = `❌ No se pudo publicar: ${err.message}. Nada cambió en el mapa; puedes reintentar o usar la descarga.`;
      actualizarBotones();
    }
  }

  function bajar(nombre, texto) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function descargar() {
    if (!resultado) return;
    bajar("mapa_inventario.json", resultado.textos.inventario);
    setTimeout(() => bajar("sigma_mapa.json", resultado.textos.grafo), 400);
    setTimeout(() => bajar("datos_meta.json", resultado.textos.meta), 800);
    $("estadoPublicar").textContent = "Se descargaron 3 archivos. En GitHub entra a la carpeta assets → Add file → Upload files, arrástralos y presiona Commit changes.";
  }

  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", iniciar) : iniciar();
})();
