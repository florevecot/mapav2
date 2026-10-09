// ======================================================
// app.map.js – Mapa (Leaflet + OpenStreetMap): sitios, filtros,
// búsqueda, medición, dependencias y módulo SII.
// Sin ArcGIS: no requiere cuenta ni genera cobros.
// ======================================================

(function () {
  const CONFIG = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
  const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const loadingIndicator = $("loadingIndicator");
  function setLoading(visible, texto) {
    if (!loadingIndicator) return;
    if (texto) loadingIndicator.querySelector("span").textContent = texto;
    loadingIndicator.style.display = visible ? "flex" : "none";
  }

  // ====================================================
  // ESTADOS OOEE (normalizados: sin número de etapa ni tildes)
  // ====================================================
  const ESTADOS_CONOCIDOS = [
    ["NO INICIADO", [128, 128, 128]],
    ["EN PROYECTO", [186, 104, 200]],
    ["EN LICITACION", [255, 165, 0]],
    ["REV ANTEPROYECTO", [255, 193, 7]],
    ["DOC ELECTRICA", [255, 152, 0]],
    ["NEG SERVIDUMBRE", [244, 81, 30]],
    ["SERVIDUMBRE OK", [230, 74, 25]],
    ["FACTIBILIDAD ELECTRICA", [171, 71, 188]],
    ["GESTION CIA. ELECTRICA", [147, 112, 219]],
    ["INGRESO ESTUDIO", [126, 87, 194]],
    ["RFE", [92, 107, 192]],
    ["EN CONSTRUCCION", [0, 0, 255]],
    ["LINEA CONSTRUIDA", [0, 191, 255]],
    ["INGRESO TE-1", [0, 151, 167]],
    ["GESTION DE CONTRATO", [0, 137, 123]],
    ["CARPETA INGRESADA", [50, 205, 50]],
    ["EJECUTADO", [0, 230, 118]],
    ["ON AIR PROVISORIO", [129, 199, 132]],
    ["ON AIR DEFINITIVO", [27, 94, 32]],
    ["TRIAL 5G", [233, 30, 99]],
    ["REPETIDOR - SOLO TX", [121, 85, 72]],
    ["PENDIENTE DE DESMANTELAR", [96, 96, 96]],
    ["DESINSTALADO", [33, 33, 33]],
    ["NODO DESINSTALADO - SOLO TX", [33, 33, 33]],
    ["ELIMINADO/TRANSACTION", [33, 33, 33]],
    ["SIN ESTADO", [255, 0, 0]]
  ];
  const ORDEN_ESTADO = new Map(ESTADOS_CONOCIDOS.map(([k], i) => [k, i]));
  const COLOR_ESTADO = new Map(ESTADOS_CONOCIDOS.map(([k, c]) => [k, c]));
  const COLORES_EXTRA = [[0, 128, 128], [128, 0, 128], [128, 128, 0], [0, 0, 128], [255, 99, 132]];
  const estadoLabels = new Map();
  const estadoConteo = new Map();

  function categoriaEstado(raw) {
    let t = normalizar(raw);
    if (!t || t === "#N/A" || t === "N/A") return "SIN ESTADO";
    t = t.replace(/^\d+\s*\.\s*/, "").replace(/\s+/g, " ").trim();
    return t || "SIN ESTADO";
  }
  function etiquetaEstado(raw, cat) {
    if (cat === "SIN ESTADO") return "Sin estado (vacío / #N/A)";
    return String(raw ?? "").trim().replace(/^\d+\s*\.\s*/, "") || cat;
  }
  function colorEstado(cat) {
    if (COLOR_ESTADO.has(cat)) return COLOR_ESTADO.get(cat);
    let h = 0;
    for (const ch of cat) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const c = COLORES_EXTRA[h % COLORES_EXTRA.length];
    COLOR_ESTADO.set(cat, c);
    return c;
  }
  const rgb = (c, a) => (a == null ? `rgb(${c.join(",")})` : `rgba(${c.join(",")},${a})`);

  // ====================================================
  // MAPA
  // ====================================================
  const map = L.map("viewDiv", {
    preferCanvas: true,          // dibuja miles de puntos rápido
    zoomControl: false,
    center: CONFIG.CENTRO_INICIAL || [-33.45, -70.66],
    zoom: CONFIG.ZOOM_INICIAL || 5,
    worldCopyJump: true
  });
  window.map = map;
  L.control.zoom({ position: "bottomright", zoomInTitle: "Acercar", zoomOutTitle: "Alejar" }).addTo(map);
  L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
  const renderer = L.canvas({ padding: 0.5, tolerance: 4 });

  // ---------- Mapas base ----------
  const mapasBase = (CONFIG.MAPAS_BASE || []).map((b) => ({
    ...b,
    layer: L.tileLayer(b.url, { maxZoom: b.maxZoom || 19, subdomains: b.subdomains || "abc", attribution: b.attribution || "" })
  }));
  let baseActual = null;
  function usarMapaBase(id) {
    const b = mapasBase.find((x) => x.id === id) || mapasBase[0];
    if (!b) return;
    if (baseActual) map.removeLayer(baseActual.layer);
    b.layer.addTo(map);
    b.layer.bringToBack();
    baseActual = b;
    document.querySelectorAll('input[name="mapaBase"]').forEach((r) => { r.checked = r.value === b.id; });
    try { localStorage.setItem("mapaBase", b.id); } catch (_) {}
  }
  function renderPanelMapaBase() {
    const cont = $("basemapContent");
    if (!cont) return;
    cont.innerHTML = "";
    mapasBase.forEach((b) => {
      const label = document.createElement("label");
      label.className = "filter-item basemap-item";
      label.innerHTML = `<input type="radio" name="mapaBase" value="${esc(b.id)}"> <span>${esc(b.nombre)}</span>`;
      label.querySelector("input").addEventListener("change", () => usarMapaBase(b.id));
      cont.appendChild(label);
    });
  }
  renderPanelMapaBase();
  let basePreferido = null;
  try { basePreferido = localStorage.getItem("mapaBase"); } catch (_) {}
  usarMapaBase(basePreferido || mapasBase[0]?.id);

  // ---------- Capas propias ----------
  const sitiosLayer = L.layerGroup().addTo(map);
  const dependenciasLayer = L.layerGroup().addTo(map);
  const resaltadoLayer = L.layerGroup().addTo(map);
  const busquedaLayer = L.layerGroup().addTo(map);
  const medicionLayer = L.layerGroup().addTo(map);
  const siiLayer = L.layerGroup().addTo(map);
  const capasSubidas = new Map(); // nombre -> { layer, colorKey, total }

  // ====================================================
  // ESTADO
  // ====================================================
  const sitios = [];                 // { id, idNorm, nombre, lat, lon, cat, raw, marker, visible }
  const sitiosPorId = new Map();     // idNorm -> sitio
  window.allPoints = sitios;
  let sinCoordenadas = 0;

  const estadosActivos = new Set();
  const nemonicosSeleccionados = new Set();
  let filtroNemonicoActivo = false;
  let nemonicosUnicos = [];

  // Herramientas que capturan clics en el mapa (solo una a la vez)
  let herramienta = null; // null | "medir" | "trazo" | "sii"
  window.siiModoActivo = false;

  // ====================================================
  // CARGA DE DATOS
  // ====================================================
  function cargarDatos() {
    setLoading(true, "Descargando inventario de sitios...");
    window.cargarJSON(CONFIG.DATA_URL || "./assets/mapa_inventario.json")
      .then((rows) => {
        if (!Array.isArray(rows)) throw new Error("El inventario no es un arreglo");
        procesarDatos(rows);
      })
      .catch((err) => {
        console.error("Error al cargar el inventario:", err);
        setLoading(false);
        alert("Error al cargar los datos del mapa: " + err.message);
      });
  }

  function procesarDatos(rows) {
    const total = rows.length;
    const lote = 1000;
    let i = 0;
    setLoading(true, "Cargando datos... 0%");

    function procesarLote() {
      const fin = Math.min(i + lote, total);
      for (; i < fin; i++) {
        const raw = rows[i];
        const lat = parseFloat(raw.Lat);
        const lon = parseFloat(raw.Long);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0 ||
            Math.abs(lat) > 90 || Math.abs(lon) > 180) { sinCoordenadas++; continue; }

        const id = String(raw.Nemonico ?? "").trim();
        const cat = categoriaEstado(raw["Estado OOEE"]);
        if (!estadoLabels.has(cat)) estadoLabels.set(cat, etiquetaEstado(raw["Estado OOEE"], cat));
        estadoConteo.set(cat, (estadoConteo.get(cat) || 0) + 1);
        estadosActivos.add(cat);

        const sitio = { id, idNorm: normalizar(id), nombre: raw["Nombre Sitio"] || "", lat, lon, cat, raw, visible: true };
        const color = colorEstado(cat);
        sitio.marker = L.circleMarker([lat, lon], {
          renderer, radius: 5, color: "#ffffff", weight: 1, fillColor: rgb(color), fillOpacity: 0.85
        });
        sitio.marker.on("click", (e) => {
          if (herramienta) return; // la herramienta activa maneja el clic
          L.DomEvent.stopPropagation(e);
          abrirPopupSitio(sitio);
        });
        sitio.marker.bindTooltip(id, { direction: "top", offset: [0, -4] });
        sitio.marker.addTo(sitiosLayer);

        sitios.push(sitio);
        if (sitio.idNorm && !sitiosPorId.has(sitio.idNorm)) sitiosPorId.set(sitio.idNorm, sitio);
      }
      setLoading(true, `Cargando datos... ${Math.round((i / total) * 100)}%`);
      if (i < total) setTimeout(procesarLote, 0);
      else {
        setLoading(false);
        actualizarContador();
        llenarListaNemonicos();
        renderPanelCapas();
        if (sinCoordenadas) console.info(`ℹ️ ${sinCoordenadas} sitios sin coordenadas válidas no se dibujan`);
      }
    }
    procesarLote();
  }

  function actualizarContador() {
    let n = 0;
    for (const s of sitios) if (s.visible) n++;
    $("visibleSitesCounter").textContent = `Sitios visibles: ${n.toLocaleString("es-CL")}` +
      (sinCoordenadas ? ` · ${sinCoordenadas} sin coordenadas` : "");
  }

  // Un solo lugar decide qué sitio se ve: estado Y nemónico
  function aplicarFiltros() {
    for (const s of sitios) {
      const ver = estadosActivos.has(s.cat) && (!filtroNemonicoActivo || nemonicosSeleccionados.has(s.id));
      if (ver !== s.visible) {
        s.visible = ver;
        if (ver) sitiosLayer.addLayer(s.marker); else sitiosLayer.removeLayer(s.marker);
      }
    }
    actualizarContador();
  }

  // ====================================================
  // POPUP DEL SITIO
  // Se muestran todos los campos con datos tal como vienen en el inventario
  // (antes había nombres escritos a mano que no coincidían y salían vacíos).
  // ====================================================
  const CAMPOS_OCULTOS = new Set(["Nemonico"]);

  function abrirPopupSitio(sitio) {
    const div = document.createElement("div");
    div.className = "site-popup";

    const h = document.createElement("div");
    h.className = "site-popup-title";
    h.innerHTML = `<b>${esc(sitio.id)}</b>${sitio.nombre ? `<br><span class="muted">${esc(sitio.nombre)}</span>` : ""}`;
    div.appendChild(h);

    const estado = document.createElement("div");
    estado.className = "site-popup-estado";
    estado.innerHTML = `<span class="estado-swatch" style="background:${rgb(colorEstado(sitio.cat))}"></span>${esc(estadoLabels.get(sitio.cat) || sitio.cat)}`;
    div.appendChild(estado);

    const fila = document.createElement("div");
    fila.className = "popup-btn-row";
    const gm = document.createElement("a");
    gm.href = `https://www.google.com/maps?q=${sitio.lat},${sitio.lon}&z=18`;
    gm.target = "_blank"; gm.rel = "noopener";
    gm.textContent = "📍 Google Maps";
    gm.className = "popup-btn"; gm.style.background = "#4285f4";
    fila.appendChild(gm);
    const mk = (txt, color, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = txt; b.className = "popup-btn"; b.style.background = color;
      b.addEventListener("click", fn);
      fila.appendChild(b);
    };
    mk("1 salto", "#2563eb", () => mostrarDependencias(sitio.id, 1));
    mk("2 saltos", "#f59e0b", () => mostrarDependencias(sitio.id, 2));
    mk("3 saltos", "#dc2626", () => mostrarDependencias(sitio.id, 3));
    mk("Limpiar", "#444", limpiarDependencias);
    div.appendChild(fila);

    const tabla = document.createElement("table");
    tabla.className = "site-popup-table";
    Object.entries(sitio.raw).forEach(([k, v]) => {
      if (CAMPOS_OCULTOS.has(k)) return;
      const val = String(v ?? "").trim();
      if (!val || val === "#N/A") return;
      const tr = document.createElement("tr");
      const esLink = /^https?:\/\//i.test(val);
      tr.innerHTML = `<th>${esc(k.trim())}</th><td>${esLink ? `<a href="${esc(val)}" target="_blank" rel="noopener">abrir</a>` : esc(val)}</td>`;
      tabla.appendChild(tr);
    });
    div.appendChild(tabla);

    L.popup({ maxWidth: 380, minWidth: 280, maxHeight: 420, autoPanPaddingTopLeft: [20, 80], autoPanPaddingBottomRight: [90, 20] })
      .setLatLng([sitio.lat, sitio.lon]).setContent(div).openOn(map);
  }

  function resaltarSitio(sitio) {
    resaltadoLayer.clearLayers();
    L.circleMarker([sitio.lat, sitio.lon], {
      renderer, radius: 11, color: "#ff8c00", weight: 3, fillColor: "#ffff00", fillOpacity: 0.6, interactive: false
    }).addTo(resaltadoLayer);
    if (!sitio.visible) mostrarToast("ℹ️ Este sitio está oculto por los filtros activos");
    let abierto = false;
    const abrir = () => { if (!abierto) { abierto = true; abrirPopupSitio(sitio); } };
    map.once("moveend", abrir);
    setTimeout(abrir, 1200); // por si el mapa no necesitaba moverse
    map.flyTo([sitio.lat, sitio.lon], Math.max(map.getZoom(), 15), { duration: 0.8 });
  }

  // ====================================================
  // BÚSQUEDA (nemónicos o direcciones)
  // ====================================================
  const searchInput = $("searchInput");
  const searchResults = $("searchResults");
  const searchType = $("searchType");
  const searchContainer = $("searchContainer");

  searchType.addEventListener("change", () => {
    searchInput.value = "";
    searchResults.style.display = "none";
    searchInput.placeholder = searchType.value === "direccion"
      ? "Escribe una dirección y presiona Enter"
      : "Buscar por nemónico o nombre";
    searchInput.focus();
  });

  searchInput.addEventListener("input", () => {
    if (searchType.value !== "nemonico") return;
    const q = searchInput.value.trim();
    if (q.length >= 2) buscarNemonicos(q); else searchResults.style.display = "none";
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { searchResults.style.display = "none"; return; }
    if (e.key !== "Enter") return;
    if (searchType.value === "direccion") { buscarDireccion(searchInput.value.trim()); return; }
    const q = normalizar(searchInput.value);
    const destino = sitiosPorId.get(q) || searchResults.querySelector(".search-result-item")?._sitio;
    if (destino) {
      resaltarSitio(destino);
      searchInput.value = destino.id;
      searchResults.style.display = "none";
    }
  });

  document.addEventListener("click", (e) => {
    if (!searchContainer.contains(e.target)) searchResults.style.display = "none";
  });

  function buscarNemonicos(texto) {
    const q = normalizar(texto);
    const empiezan = [], contienen = [];
    for (const s of sitios) {
      if (s.idNorm.startsWith(q)) empiezan.push(s);
      else if (s.idNorm.includes(q) || normalizar(s.nombre).includes(q)) contienen.push(s);
      if (empiezan.length >= 50) break;
    }
    mostrarResultados([...empiezan, ...contienen].slice(0, 50).map((s) => ({
      html: `<b>${esc(s.id)}</b>${s.nombre ? ` <span class="muted">· ${esc(s.nombre)}</span>` : ""}`,
      sitio: s,
      accion: () => { resaltarSitio(s); searchInput.value = s.id; }
    })));
  }

  async function buscarDireccion(q) {
    if (q.length < 3) return;
    mostrarResultados([{ html: `<span class="muted">Buscando…</span>`, accion: null }]);
    try {
      const datos = await nominatim("search", { q, countrycodes: "cl", limit: 6, addressdetails: 0 });
      if (!datos.length) { mostrarResultados([{ html: `<span class="muted">Sin resultados</span>`, accion: null }]); return; }
      mostrarResultados(datos.map((d) => ({
        html: esc(d.display_name),
        accion: () => {
          const lat = parseFloat(d.lat), lon = parseFloat(d.lon);
          busquedaLayer.clearLayers();
          L.marker([lat, lon]).bindPopup(esc(d.display_name)).addTo(busquedaLayer).openPopup();
          map.flyTo([lat, lon], 17, { duration: 0.8 });
        }
      })));
    } catch (err) {
      mostrarResultados([{ html: `<span class="muted">Error al buscar: ${esc(err.message)}</span>`, accion: null }]);
    }
  }

  function mostrarResultados(items) {
    searchResults.innerHTML = "";
    if (!items.length) { searchResults.style.display = "none"; return; }
    items.forEach((it) => {
      const div = document.createElement("div");
      div.className = "search-result-item";
      div.innerHTML = it.html;
      if (it.sitio) div._sitio = it.sitio;
      if (it.accion) div.addEventListener("click", () => { it.accion(); searchResults.style.display = "none"; });
      searchResults.appendChild(div);
    });
    searchResults.style.display = "block";
  }

  // ---------- Nominatim (OpenStreetMap) con límite de 1 consulta/segundo ----------
  let ultimaNominatim = 0;
  let colaNominatim = Promise.resolve();
  function nominatim(tipo, params) {
    const tarea = colaNominatim.then(async () => {
      const espera = ultimaNominatim + 1100 - Date.now();
      if (espera > 0) await sleep(espera);
      ultimaNominatim = Date.now();
      const url = new URL(`${CONFIG.NOMINATIM_URL || "https://nominatim.openstreetmap.org"}/${tipo}`);
      Object.entries({ format: "jsonv2", "accept-language": "es", ...params }).forEach(([k, v]) => url.searchParams.set(k, v));
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Nominatim respondió ${r.status}`);
      return r.json();
    });
    colaNominatim = tarea.catch(() => {});
    return tarea;
  }

  // ====================================================
  // PANEL DE CAPAS (capas + filtro por estado)
  // ====================================================
  function renderPanelCapas() {
    const cont = $("layersContent");
    if (!cont) return;
    cont.innerHTML = "";

    const h1 = document.createElement("h4");
    h1.className = "panel-subtitle";
    h1.textContent = "Capas";
    cont.appendChild(h1);

    const capas = [
      ["📡 Torres WOM", sitiosLayer],
      ["🔗 Dependencias de sitios", dependenciasLayer],
      ["✏️ Línea servidumbre SII", siiLayer],
      ["📏 Medición", medicionLayer],
      ...[...capasSubidas.entries()].map(([n, c]) => [`📍 ${n}`, c.layer])
    ];
    capas.forEach(([nombre, layer]) => {
      const label = document.createElement("label");
      label.className = "filter-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = map.hasLayer(layer);
      cb.addEventListener("change", () => { if (cb.checked) map.addLayer(layer); else map.removeLayer(layer); });
      const span = document.createElement("span");
      span.textContent = nombre;
      label.append(cb, span);
      cont.appendChild(label);
    });

    // Capas externas (SEC, SUBTEL): las dibuja js/capas.externas.js
    const ext = document.createElement("div");
    cont.appendChild(ext);
    window.CapasExternas?.renderEnPanel(ext);

    const h2 = document.createElement("h4");
    h2.className = "panel-subtitle";
    h2.textContent = "Estado OOEE";
    cont.appendChild(h2);

    if (!estadoConteo.size) {
      cont.insertAdjacentHTML("beforeend", `<p class="muted">Cargando estados...</p>`);
      return;
    }

    const acciones = document.createElement("div");
    acciones.className = "filter-actions";
    const bTodos = document.createElement("button");
    bTodos.className = "filter-action-btn"; bTodos.textContent = "Todos";
    const bNinguno = document.createElement("button");
    bNinguno.className = "filter-action-btn"; bNinguno.textContent = "Ninguno";
    acciones.append(bTodos, bNinguno);
    cont.appendChild(acciones);

    const cats = [...estadoConteo.keys()].sort((a, b) =>
      (ORDEN_ESTADO.get(a) ?? 999) - (ORDEN_ESTADO.get(b) ?? 999) || a.localeCompare(b));
    const checks = [];
    cats.forEach((cat) => {
      const label = document.createElement("label");
      label.className = "filter-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = estadosActivos.has(cat);
      cb.addEventListener("change", () => {
        if (cb.checked) estadosActivos.add(cat); else estadosActivos.delete(cat);
        aplicarFiltros();
      });
      const sw = document.createElement("span");
      sw.className = "estado-swatch";
      sw.style.background = rgb(colorEstado(cat));
      const txt = document.createElement("span");
      txt.textContent = `${estadoLabels.get(cat) || cat} (${estadoConteo.get(cat)})`;
      label.append(cb, sw, txt);
      cont.appendChild(label);
      checks.push([cat, cb]);
    });
    bTodos.addEventListener("click", () => { checks.forEach(([c, cb]) => { cb.checked = true; estadosActivos.add(c); }); aplicarFiltros(); });
    bNinguno.addEventListener("click", () => { checks.forEach(([c, cb]) => { cb.checked = false; estadosActivos.delete(c); }); aplicarFiltros(); });
  }

  // ====================================================
  // FILTRO DE NEMÓNICOS
  // ====================================================
  const searchNemonicos = $("searchNemonicos");
  const clearNemonico = $("clearNemonicoSearch");
  const nemonicoList = $("nemonicoList");

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  searchNemonicos.addEventListener("input", debounce(() => {
    const q = searchNemonicos.value.trim();
    clearNemonico.style.visibility = q ? "visible" : "hidden";
    filtrarListaNemonicos(q);
  }, 150));
  clearNemonico.addEventListener("click", () => {
    searchNemonicos.value = "";
    clearNemonico.style.visibility = "hidden";
    filtrarListaNemonicos("");
  });
  $("selectAllNemonicos").addEventListener("click", () => marcarVisibles(true));
  $("deselectAllNemonicos").addEventListener("click", () => marcarVisibles(false));
  $("applyNemonicoFilter").addEventListener("click", () => {
    filtroNemonicoActivo = nemonicosSeleccionados.size !== nemonicosUnicos.length;
    aplicarFiltros();
    window.UI?.cerrarPanel("nemonicoFilterPanel");
    mostrarToast(filtroNemonicoActivo
      ? `📋 Filtro aplicado: ${nemonicosSeleccionados.size} nemónico(s)`
      : "📋 Mostrando todos los nemónicos");
  });
  nemonicoList.addEventListener("change", (e) => {
    const cb = e.target;
    if (cb.type !== "checkbox") return;
    if (cb.checked) nemonicosSeleccionados.add(cb.value); else nemonicosSeleccionados.delete(cb.value);
    actualizarEstadoFiltro();
  });

  function marcarVisibles(valor) {
    nemonicoList.querySelectorAll(".nemonico-item").forEach((item) => {
      if (item.style.display === "none") return;
      const cb = item.querySelector("input");
      cb.checked = valor;
      if (valor) nemonicosSeleccionados.add(cb.value); else nemonicosSeleccionados.delete(cb.value);
    });
    actualizarEstadoFiltro();
  }

  function filtrarListaNemonicos(texto) {
    const q = normalizar(texto);
    let hay = false;
    nemonicoList.querySelectorAll(".nemonico-item").forEach((item) => {
      const ok = !q || item.dataset.id.includes(q);
      item.style.display = ok ? "flex" : "none";
      if (ok) hay = true;
    });
    let noRes = $("noNemonicoResults");
    if (!hay && !noRes) {
      noRes = document.createElement("div");
      noRes.id = "noNemonicoResults";
      noRes.className = "no-results";
      noRes.textContent = "No se encontraron nemónicos con ese texto";
      nemonicoList.appendChild(noRes);
    } else if (hay && noRes) noRes.remove();
  }

  function llenarListaNemonicos() {
    nemonicoList.innerHTML = "";
    nemonicosUnicos = [...new Set(sitios.map((s) => s.id).filter(Boolean))].sort();
    nemonicosSeleccionados.clear();
    const frag = document.createDocumentFragment();
    nemonicosUnicos.forEach((id) => {
      nemonicosSeleccionados.add(id);
      const label = document.createElement("label");
      label.className = "nemonico-item";
      label.dataset.id = normalizar(id);
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = id; cb.checked = true;
      const span = document.createElement("span");
      span.textContent = id;
      label.append(cb, span);
      frag.appendChild(label);
    });
    nemonicoList.appendChild(frag);
    actualizarEstadoFiltro();
  }

  function actualizarEstadoFiltro() {
    $("filterStatus").textContent = `${nemonicosSeleccionados.size} de ${nemonicosUnicos.length} nemónicos seleccionados`;
  }

  // ====================================================
  // HERRAMIENTA DE DIBUJO (compartida por "Medir" y "Trazar línea SII")
  // Clic agrega un vértice, doble clic termina, Esc cancela.
  // ====================================================
  let dibujo = null; // { puntos, linea, guia, alTerminar, alActualizar }

  function iniciarDibujo({ color, alActualizar, alTerminar }) {
    cancelarDibujo();
    map.doubleClickZoom.disable();
    map.getContainer().classList.add("cursor-dibujo");
    dibujo = {
      puntos: [],
      linea: L.polyline([], { color, weight: 3 }).addTo(medicionLayer),
      guia: L.polyline([], { color, weight: 2, dashArray: "4 6", interactive: false }).addTo(medicionLayer),
      alActualizar, alTerminar
    };
  }

  function cancelarDibujo() {
    if (!dibujo) return;
    medicionLayer.removeLayer(dibujo.linea);
    medicionLayer.removeLayer(dibujo.guia);
    dibujo = null;
    terminarDibujoUI();
  }

  function terminarDibujoUI() {
    map.getContainer().classList.remove("cursor-dibujo");
    setTimeout(() => map.doubleClickZoom.enable(), 300);
  }

  function puntoDibujo(latlng) {
    if (!dibujo) return;
    const ult = dibujo.puntos[dibujo.puntos.length - 1];
    // el doble clic genera clics repetidos en el mismo lugar: se ignoran
    if (ult && map.latLngToContainerPoint(ult).distanceTo(map.latLngToContainerPoint(latlng)) < 4) return;
    dibujo.puntos.push(latlng);
    dibujo.linea.setLatLngs(dibujo.puntos);
    dibujo.alActualizar?.(dibujo.puntos, dibujo.linea);
  }

  function finalizarDibujo() {
    if (!dibujo) return;
    const d = dibujo;
    dibujo = null;
    medicionLayer.removeLayer(d.guia);
    terminarDibujoUI();
    d.alTerminar?.(d.puntos, d.linea);
  }

  map.on("mousemove", (e) => {
    if (!dibujo || !dibujo.puntos.length) return;
    dibujo.guia.setLatLngs([dibujo.puntos[dibujo.puntos.length - 1], e.latlng]);
  });
  map.on("dblclick", (e) => {
    if (!dibujo) return;
    L.DomEvent.stop(e);
    finalizarDibujo();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dibujo) {
      const h = herramienta;
      cancelarDibujo();
      if (h === "medir") desactivarMedicion();
      if (h === "trazo") terminarModoTrazo();
    }
  });

  // Clic único en el mapa: lo atiende la herramienta activa
  map.on("click", (e) => {
    if (dibujo) { puntoDibujo(e.latlng); return; }
    if (herramienta === "sii") { consultarRolPorPunto(e.latlng); return; }
    if (!herramienta) window.CapasExternas?.identificar(e.latlng);
  });
  window.herramientaActiva = () => !!(herramienta || dibujo);

  function largoMetros(puntos) {
    let m = 0;
    for (let i = 1; i < puntos.length; i++) m += puntos[i - 1].distanceTo(puntos[i]);
    return m;
  }
  const formatoDistancia = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

  // ====================================================
  // MEDIR
  // ====================================================
  function activarMedicion() {
    desactivarHerramientas();
    herramienta = "medir";
    medicionLayer.clearLayers();
    if (!map.hasLayer(medicionLayer)) map.addLayer(medicionLayer);
    mostrarToast("📏 Clic para agregar puntos · doble clic para terminar · Esc para cancelar");
    const empezar = () => iniciarDibujo({
      color: "#7212e8",
      alActualizar: (pts, linea) => {
        if (pts.length > 1) linea.bindTooltip(formatoDistancia(largoMetros(pts)), { permanent: true, direction: "right", className: "medicion-tooltip" }).openTooltip(pts[pts.length - 1]);
      },
      alTerminar: (pts, linea) => {
        if (pts.length > 1) {
          linea.bindTooltip(`Total: ${formatoDistancia(largoMetros(pts))}`, { permanent: true, direction: "right", className: "medicion-tooltip" }).openTooltip(pts[pts.length - 1]);
        } else medicionLayer.removeLayer(linea);
        if (herramienta === "medir") empezar(); // permite medir otra línea
      }
    });
    empezar();
  }

  function desactivarMedicion() {
    if (herramienta === "medir") herramienta = null;
    cancelarDibujo();
    medicionLayer.clearLayers();
    $("measurementBtn")?.classList.remove("active");
  }

  window.toggleMeasurement = function () {
    if (herramienta === "medir") { desactivarMedicion(); return false; }
    activarMedicion();
    return true;
  };

  function desactivarHerramientas() {
    if (herramienta === "medir") desactivarMedicion();
    if (herramienta === "trazo") { cancelarDibujo(); terminarModoTrazo(); }
    if (herramienta === "sii") desactivarClickSII();
  }

  // ====================================================
  // MI UBICACIÓN
  // ====================================================
  const ubicacionLayer = L.layerGroup().addTo(map);
  window.ubicarme = function () {
    if (!navigator.geolocation) { alert("Tu navegador no permite obtener la ubicación."); return; }
    mostrarToast("📍 Buscando tu ubicación...");
    map.locate({ setView: true, maxZoom: 15, enableHighAccuracy: true });
  };
  map.on("locationfound", (e) => {
    ubicacionLayer.clearLayers();
    L.circle(e.latlng, { radius: e.accuracy, color: "#2563eb", weight: 1, fillOpacity: 0.1, interactive: false }).addTo(ubicacionLayer);
    L.circleMarker(e.latlng, { radius: 7, color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 })
      .bindPopup(`Tu ubicación (±${Math.round(e.accuracy)} m)`).addTo(ubicacionLayer);
  });
  map.on("locationerror", (e) => alert("No se pudo obtener tu ubicación: " + e.message));

  // ====================================================
  // CAPAS JSON SUBIDAS POR EL USUARIO
  // ====================================================
  const fileInput = $("fileInput");
  const uploadList = $("uploadList");
  const usedColors = new Set();
  const paleta = [[255, 99, 132], [54, 162, 235], [255, 206, 86], [75, 192, 192], [153, 102, 255],
    [255, 159, 64], [0, 128, 0], [128, 0, 128], [0, 0, 128], [128, 128, 0]];

  function siguienteColor() {
    for (const c of paleta) { const k = c.join(","); if (!usedColors.has(k)) { usedColors.add(k); return c; } }
    const c = [0, 0, 0].map(() => Math.floor(Math.random() * 256));
    usedColors.add(c.join(","));
    return c;
  }

  fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!Array.isArray(data)) throw new Error("El JSON debe ser un arreglo de objetos con latitud y longitud");
        const base = file.name.replace(/\.json$/i, "");
        let nombre = base, n = 2;
        while (capasSubidas.has(nombre)) nombre = `${base} (${n++})`;

        const color = siguienteColor();
        const colorKey = color.join(",");
        const layer = L.featureGroup();
        let total = 0;
        data.forEach((item) => {
          if (!item || typeof item !== "object") return;
          const lat = parseFloat(item.latitud ?? item.lat ?? item.Lat ?? item.latitude);
          const lon = parseFloat(item.longitud ?? item.lon ?? item.lng ?? item.Long ?? item.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
          const extra = Object.entries(item)
            .filter(([k]) => k !== "nombre")
            .map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join("<br>");
          L.marker([lat, lon], {
            icon: L.divIcon({ className: "tri-icon", html: `<div class="tri" style="border-bottom-color:${rgb(color)}"></div>`, iconSize: [14, 12], iconAnchor: [7, 6] })
          }).bindPopup(`<b>${esc(item.nombre ?? nombre)}</b><br><a href="https://www.google.com/maps?q=${lat},${lon}&z=18" target="_blank" rel="noopener">Ver en Google Maps</a><br><br>${extra}`)
            .addTo(layer);
          total++;
        });
        if (!total) { usedColors.delete(colorKey); alert("El archivo no tiene puntos con 'latitud' y 'longitud' válidas."); return; }
        layer.addTo(map);
        capasSubidas.set(nombre, { layer, colorKey, total });
        agregarItemSubida(nombre, total, color);
        map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 15 });
        renderPanelCapas();
      } catch (err) {
        console.error(err);
        alert("Error en el archivo JSON: " + err.message);
      } finally {
        fileInput.value = "";
      }
    };
    reader.readAsText(file);
  });

  function agregarItemSubida(nombre, total, color) {
    const item = document.createElement("div");
    item.className = "upload-item";
    const span = document.createElement("span");
    span.innerHTML = `<i class="upload-color" style="background:${rgb(color)}"></i>${esc(nombre)} (${total})`;
    const btn = document.createElement("button");
    btn.textContent = "❌"; btn.title = "Quitar capa";
    btn.addEventListener("click", () => {
      const c = capasSubidas.get(nombre);
      if (c) { map.removeLayer(c.layer); usedColors.delete(c.colorKey); capasSubidas.delete(nombre); }
      item.remove();
      renderPanelCapas();
    });
    item.append(span, btn);
    uploadList.appendChild(item);
  }

  // ====================================================
  // DEPENDENCIAS EN EL MAPA
  // Usa las conexiones del archivo local del grafo (ya no depende de ArcGIS).
  // ====================================================
  let adyacencia = null;

  async function cargarAdyacencia() {
    if (adyacencia) return adyacencia;
    const data = await window.cargarJSON(CONFIG.GRAPH_URL || "./assets/sigma_mapa.json");
    const adj = new Map();
    (data.edges || []).forEach((e) => {
      const a = normalizar(e.from ?? e.source), b = normalizar(e.to ?? e.target);
      if (!a || !b || a === b) return;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b);
      adj.get(b).add(a);
    });
    adyacencia = adj;
    return adj;
  }

  function bfsNiveles(inicio, adj, maxDepth) {
    const niveles = new Map([[inicio, 0]]);
    let frontera = [inicio];
    for (let d = 1; d <= maxDepth && frontera.length; d++) {
      const sig = [];
      for (const u of frontera) for (const v of adj.get(u) || []) {
        if (!niveles.has(v)) { niveles.set(v, d); sig.push(v); }
      }
      frontera = sig;
    }
    return niveles;
  }

  const ESTILO_SALTO = { 1: ["#0078ff", 3], 2: ["#ffa500", 2.5], 3: ["#ff0000", 2] };

  async function mostrarDependencias(siteId, maxDepth = 1) {
    limpiarDependencias();
    const raiz = normalizar(siteId);
    const principal = sitiosPorId.get(raiz);
    if (!principal) { mostrarToast("❌ Sitio no encontrado: " + siteId); return 0; }
    if (!map.hasLayer(dependenciasLayer)) map.addLayer(dependenciasLayer);

    let adj;
    try { adj = await cargarAdyacencia(); }
    catch (err) { console.error(err); mostrarToast("⚠️ No se pudieron cargar las conexiones"); return 0; }

    const niveles = bfsNiveles(raiz, adj, maxDepth);
    const dibujadas = new Set();
    const limites = L.latLngBounds([[principal.lat, principal.lon]]);

    niveles.forEach((dU, u) => {
      for (const v of adj.get(u) || []) {
        if (!niveles.has(v)) continue;
        const key = u < v ? `${u}|${v}` : `${v}|${u}`;
        if (dibujadas.has(key)) continue;
        dibujadas.add(key);
        const a = sitiosPorId.get(u), b = sitiosPorId.get(v);
        if (!a || !b) continue;
        const [color, w] = ESTILO_SALTO[Math.max(dU, niveles.get(v))] || ESTILO_SALTO[3];
        L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color, weight: w, dashArray: "6 6", opacity: 0.9, interactive: false })
          .addTo(dependenciasLayer);
      }
    });

    niveles.forEach((d, id) => {
      const s = sitiosPorId.get(id);
      if (!s) return;
      const esRaiz = id === raiz;
      const m = L.circleMarker([s.lat, s.lon], {
        renderer, radius: esRaiz ? 9 : 7, color: "#000", weight: 2, fillColor: rgb(colorEstado(s.cat)), fillOpacity: 1
      }).addTo(dependenciasLayer);
      m.bindTooltip(s.id, { permanent: true, direction: "top", offset: [0, -8], className: esRaiz ? "dep-label raiz" : "dep-label" });
      m.on("click", (e) => { if (herramienta) return; L.DomEvent.stopPropagation(e); abrirPopupSitio(s); });
      limites.extend([s.lat, s.lon]);
    });

    const n = niveles.size - 1;
    const sinCoord = [...niveles.keys()].filter((id) => !sitiosPorId.has(id)).length;
    mostrarToast(n
      ? `🔗 ${n} sitio(s) a ${maxDepth} salto(s)` + (sinCoord ? ` (${sinCoord} sin coordenadas)` : "")
      : "ℹ️ Este sitio no tiene dependencias registradas");
    if (n) map.flyToBounds(limites, { padding: [60, 60], maxZoom: 15, duration: 0.8 });
    return n;
  }

  function limpiarDependencias() { dependenciasLayer.clearLayers(); }
  window.mostrarDependencias = mostrarDependencias;
  window.limpiarDependencias = limpiarDependencias;

  // ====================================================
  // MÓDULO SII — PREDIOS Y SERVIDUMBRE ELÉCTRICA
  // ====================================================
  const SII_VISOR = "https://www4.sii.cl/mapasui/internet/#/contenido/index.html";
  const PROXY = (CONFIG.SII_PROXY_URL || "").trim();
  let bufferDistancia = 100;
  let consultandoLinea = false;
  let rolesEncontrados = [];

  function nombreCapaComuna(comuna) {
    return normalizar(comuna).replace(/ /g, "_").replace(/[^A-Z0-9_]/g, "");
  }

  // Comuna probable de un punto. Primero se usa la comuna del sitio WOM más
  // cercano (instantáneo y sin límites); como respaldo, OpenStreetMap.
  function comunaSitioCercano(lat, lon) {
    const k = Math.cos(lat * Math.PI / 180);
    let mejor = null, dMin = Infinity;
    for (const s of sitios) {
      const dx = (s.lon - lon) * k, dy = s.lat - lat;
      const d = dx * dx + dy * dy;
      if (d < dMin) { dMin = d; mejor = s; }
    }
    const km = Math.sqrt(dMin) * 111;
    return mejor && km < 15 ? String(mejor.raw.Comuna || "") : "";
  }

  const comunaOSMCache = new Map();
  async function comunaOSM(lat, lon) {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (comunaOSMCache.has(key)) return comunaOSMCache.get(key);
    let res = { comuna: "", direccion: "" };
    try {
      const d = await nominatim("reverse", { lat, lon, zoom: 18, addressdetails: 1 });
      const a = d.address || {};
      res = {
        comuna: a.city || a.town || a.village || a.municipality || a.suburb || "",
        direccion: [a.road, a.house_number].filter(Boolean).join(" ")
      };
    } catch (_) {}
    comunaOSMCache.set(key, res);
    return res;
  }

  async function llamarSII(lat, lon, layerName) {
    const d = 0.0005;
    const capa = `sii:BR_CART_${layerName}_WMS`;
    const body = {
      clickInfo: {
        x: 50, y: 50,
        // El visor del SII usa orden lat/lon (x = latitud)
        southwestx: lat - d, southwesty: lon - d,
        northeastx: lat + d, northeasty: lon + d,
        layer: capa, width: 101, height: 101,
        servicios: [{ comuna: 0, layer: capa, style: "PREDIOS_WMS_V0", eac: 0, eacano: 0 }]
      }
    };
    const resp = await fetch(`${PROXY}?endpoint=getFeatureInfo`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Proxy SII respondió ${resp.status}`);
    const data = await resp.json();
    const p = data?.data || null;
    return (p && (p.existePredio || p.rol || p.manzana)) ? p : null;
  }

  async function consultarPredioSII(lat, lon, { usarOSM = true } = {}) {
    const c1 = comunaSitioCercano(lat, lon);
    if (c1) {
      const predio = await llamarSII(lat, lon, nombreCapaComuna(c1));
      if (predio) return { predio, comuna: c1, layerName: nombreCapaComuna(c1), direccion: "" };
    }
    if (!usarOSM) return { predio: null, comuna: c1, layerName: nombreCapaComuna(c1), direccion: "" };

    const osm = await comunaOSM(lat, lon);
    if (osm.comuna && nombreCapaComuna(osm.comuna) !== nombreCapaComuna(c1)) {
      const predio = await llamarSII(lat, lon, nombreCapaComuna(osm.comuna));
      if (predio) return { predio, comuna: osm.comuna, layerName: nombreCapaComuna(osm.comuna), direccion: osm.direccion };
    }
    const comuna = osm.comuna || c1;
    return { predio: null, comuna, layerName: nombreCapaComuna(comuna), direccion: osm.direccion };
  }

  function datosPredio(p, comunaFallback, lat, lon) {
    return {
      rol: p.rol || (p.manzana != null ? `${p.manzana}-${p.predio}` : ""),
      direccion: p.direccion || "",
      comuna: p.nombreComuna || comunaFallback || "",
      avaluo: p.valorTotal ? Number(p.valorTotal) : null,
      lat, lon
    };
  }

  function botonesSII(lat, lon) {
    const fila = document.createElement("div");
    fila.className = "popup-btn-row";
    const gm = document.createElement("a");
    gm.href = `https://www.google.com/maps?q=${lat},${lon}&z=19`;
    gm.target = "_blank"; gm.rel = "noopener";
    gm.textContent = "📍 Google Maps"; gm.className = "popup-btn"; gm.style.background = "#4285f4";
    const sii = document.createElement("a");
    sii.href = SII_VISOR; sii.target = "_blank"; sii.rel = "noopener";
    sii.textContent = "🔗 Visor SII"; sii.className = "popup-btn"; sii.style.background = "#e84229";
    const vec = document.createElement("button");
    vec.type = "button"; vec.textContent = "🗺️ Ver vecinos"; vec.className = "popup-btn"; vec.style.background = "#16a34a";
    vec.addEventListener("click", mostrarMapaSII);
    fila.append(gm, sii, vec);
    return fila;
  }

  async function consultarRolPorPunto(latlng) {
    const { lat, lng: lon } = latlng;
    const popup = L.popup({ maxWidth: 340 }).setLatLng(latlng)
      .setContent(`<div class="sii-popup">🔍 Consultando predio SII…</div>`).openOn(map);
    const div = document.createElement("div");
    div.className = "sii-popup";
    try {
      const r = await consultarPredioSII(lat, lon);
      if (r.predio) {
        const p = datosPredio(r.predio, r.comuna, lat, lon);
        div.innerHTML = `
          <div class="site-popup-title"><b>🏘️ Rol ${esc(p.rol)}</b></div>
          <b>Rol Predial:</b> <span class="sii-rol">${esc(p.rol)}</span><br>
          ${p.direccion ? `<b>Dirección:</b> ${esc(p.direccion)}<br>` : ""}
          <b>Comuna:</b> ${esc(p.comuna)}<br>
          ${p.avaluo ? `<b>Avalúo Total:</b> $${p.avaluo.toLocaleString("es-CL")}<br>` : ""}
          <b>Coordenadas:</b> ${lat.toFixed(6)}, ${lon.toFixed(6)}<br>`;
        const add = document.createElement("button");
        add.type = "button"; add.textContent = "➕ Agregar a la lista"; add.className = "popup-btn"; add.style.background = "#7212e8";
        add.addEventListener("click", () => { agregarRol(p); add.disabled = true; add.textContent = "✔ Agregado"; });
        div.appendChild(add);
      } else {
        div.innerHTML = `
          <div class="site-popup-title"><b>🏘️ Consultar Predio SII</b></div>
          ${r.direccion ? `<b>Dirección:</b> ${esc(r.direccion)}<br>` : ""}
          ${r.comuna ? `<b>Comuna:</b> ${esc(r.comuna)}<br>` : ""}
          <b>Coordenadas:</b> ${lat.toFixed(6)}, ${lon.toFixed(6)}<br>
          <small class="muted">No se encontró predio SII en este punto.</small><br>`;
      }
    } catch (err) {
      console.warn("Error consultando SII:", err);
      div.innerHTML = `<b>Coordenadas:</b> ${lat.toFixed(6)}, ${lon.toFixed(6)}<br>
        <small class="muted">Error al consultar el SII (${esc(err.message)}).</small><br>`;
    }
    div.appendChild(botonesSII(lat, lon));
    popup.setContent(div);
    if (!map.hasLayer(popup)) popup.openOn(map);
  }

  // ---------- Panel flotante con el visor del SII ----------
  let arrastrando = false, dX = 0, dY = 0, dL = 0, dT = 0, listenersArrastre = false;
  function mostrarMapaSII() {
    let panel = $("siiMapaPanel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "siiMapaPanel";
      panel.className = "sii-float-panel";
      panel.innerHTML = `
        <div class="sii-float-header" id="siiPanelHeader">
          <b>🗺️ Visor SII <small>· arrastra para mover</small></b>
          <span>
            <a href="${SII_VISOR}" target="_blank" rel="noopener" title="Abrir en pestaña nueva">↗</a>
            <button type="button" id="siiPanelClose" title="Cerrar">×</button>
          </span>
        </div>
        <iframe src="${SII_VISOR}" title="Visor SII" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
        <div class="sii-float-note">Si el visor aparece en blanco, el SII no permite mostrarlo embebido: usa ↗ para abrirlo en otra pestaña.</div>`;
      document.body.appendChild(panel);
      $("siiPanelClose").addEventListener("click", () => { panel.style.display = "none"; });
      $("siiPanelHeader").addEventListener("mousedown", (e) => {
        if (e.target.closest("button, a")) return;
        arrastrando = true; dX = e.clientX; dY = e.clientY; dL = panel.offsetLeft; dT = panel.offsetTop;
        e.preventDefault();
      });
    }
    if (!listenersArrastre) {
      listenersArrastre = true;
      document.addEventListener("mousemove", (e) => {
        if (!arrastrando) return;
        const p = $("siiMapaPanel");
        p.style.left = (dL + e.clientX - dX) + "px";
        p.style.top = (dT + e.clientY - dY) + "px";
      });
      document.addEventListener("mouseup", () => { arrastrando = false; });
    }
    panel.style.display = "flex";
  }

  // ---------- Línea de servidumbre ----------
  const MAX_PUNTOS_LINEA = 60;

  async function consultarRolesPorLinea(puntos) {
    if (consultandoLinea) { mostrarToast("⏳ Ya hay una consulta en curso"); return; }
    if (puntos.length < 2) { mostrarToast("La línea necesita al menos 2 puntos"); return; }
    consultandoLinea = true;
    rolesEncontrados = [];
    mostrarPanelRoles();
    actualizarEstadoPanel("🔍 Preparando puntos de consulta...", "loading");

    try {
      const linea = turf.lineString(puntos.map((p) => [p.lng, p.lat]));
      L.geoJSON(turf.buffer(linea, bufferDistancia, { units: "meters" }), {
        style: { color: "#ff6400", weight: 2, dashArray: "6 6", fillColor: "#ff6400", fillOpacity: 0.1 },
        interactive: false
      }).addTo(siiLayer);

      const lineas = [linea];
      if (bufferDistancia >= 20) {
        lineas.push(turf.lineOffset(linea, bufferDistancia, { units: "meters" }));
        lineas.push(turf.lineOffset(linea, -bufferDistancia, { units: "meters" }));
      }
      const largo = turf.length(linea, { units: "meters" });
      const porLinea = Math.max(2, Math.min(Math.floor(MAX_PUNTOS_LINEA / lineas.length), Math.ceil(largo / 30) + 1));
      const muestras = [];
      lineas.forEach((l) => {
        const L2 = turf.length(l, { units: "meters" });
        for (let k = 0; k < porLinea; k++) {
          const [lon, lat] = turf.along(l, (L2 * k) / (porLinea - 1), { units: "meters" }).geometry.coordinates;
          muestras.push({ lat, lon });
        }
      });

      const vistos = new Set();
      for (let i = 0; i < muestras.length; i++) {
        const { lat, lon } = muestras[i];
        actualizarEstadoPanel(`🔍 Consultando SII ${i + 1}/${muestras.length} — ${rolesEncontrados.length} predio(s)`, "loading");
        try {
          // OpenStreetMap permite 1 consulta/seg: en la línea se usa solo cada 10 puntos como respaldo
          const r = await consultarPredioSII(lat, lon, { usarOSM: i % 10 === 0 });
          if (r.predio) {
            const p = datosPredio(r.predio, r.comuna, lat, lon);
            const key = `${p.comuna}|${p.rol}`;
            if (p.rol && !vistos.has(key)) {
              vistos.add(key);
              rolesEncontrados.push(p);
              L.circleMarker([lat, lon], { renderer, radius: 6, color: "#fff", weight: 1, fillColor: "#e84229", fillOpacity: 0.9 })
                .bindPopup(`<b>Rol ${esc(p.rol)}</b><br>${esc(p.direccion)}<br>${esc(p.comuna)}`)
                .addTo(siiLayer);
              mostrarPanelRoles();
            }
          }
        } catch (err) {
          console.warn("Punto SII con error:", err.message);
        }
        await sleep(150); // no saturar al SII
      }

      mostrarPanelRoles();
      actualizarEstadoPanel(
        rolesEncontrados.length
          ? `✅ ${rolesEncontrados.length} predio(s) encontrado(s) en ${muestras.length} puntos consultados`
          : `ℹ️ No se encontraron predios (${muestras.length} puntos consultados)`,
        rolesEncontrados.length ? "success" : "info");
    } catch (err) {
      console.error(err);
      actualizarEstadoPanel("⚠️ Error al procesar la línea: " + err.message, "error");
    } finally {
      consultandoLinea = false;
    }
  }

  function agregarRol(p) {
    if (!rolesEncontrados.some((r) => r.rol === p.rol && r.comuna === p.comuna)) rolesEncontrados.push(p);
    mostrarPanelRoles();
    actualizarEstadoPanel(`${rolesEncontrados.length} predio(s) en la lista`, "info");
  }

  // ---------- UI del módulo SII ----------
  function inyectarUISII() {
    const toolsMap = $("toolsMap");
    if (!toolsMap) return;
    const sep = document.createElement("hr");
    sep.className = "sidebar-sep";
    const h = document.createElement("h3");
    h.textContent = "Predios SII";
    toolsMap.append(sep, h);

    if (!PROXY) {
      const aviso = document.createElement("p");
      aviso.className = "upload-info";
      aviso.textContent = "Herramientas SII desactivadas: falta configurar SII_PROXY_URL en js/config.js.";
      toolsMap.appendChild(aviso);
      return;
    }

    const btnClick = document.createElement("button");
    btnClick.id = "btnToggleSII";
    btnClick.className = "sidebar-btn";
    btnClick.title = "Consultar predio con un clic";
    btnClick.innerHTML = "🏘️ <span>Activar Click Predios SII</span>";
    btnClick.addEventListener("click", () => {
      if (herramienta === "sii") { desactivarClickSII(); return; }
      desactivarHerramientas();
      herramienta = "sii";
      window.siiModoActivo = true;
      btnClick.classList.add("active");
      btnClick.querySelector("span").textContent = "Desactivar Click Predios";
      map.getContainer().classList.add("cursor-dibujo");
      mostrarToast("🏘️ Haz clic en el mapa para consultar el predio SII");
    });

    const btnTrazo = document.createElement("button");
    btnTrazo.id = "btnSIITrazo";
    btnTrazo.className = "sidebar-btn";
    btnTrazo.title = "Trazar línea de servidumbre";
    btnTrazo.innerHTML = "📐 <span>Trazar Línea Servidumbre</span>";
    btnTrazo.addEventListener("click", toggleModoTrazo);

    const bufferDiv = document.createElement("div");
    bufferDiv.id = "siiBufferControl";
    bufferDiv.className = "sii-buffer";
    bufferDiv.innerHTML = `<label>Buffer: <b id="siiBufferVal">100</b> m
      <input type="range" id="siiBufferSlider" min="10" max="1000" step="10" value="100"></label>`;

    const btnLimpiar = document.createElement("button");
    btnLimpiar.id = "btnLimpiarSII";
    btnLimpiar.className = "sidebar-btn";
    btnLimpiar.innerHTML = "🧹 <span>Limpiar Trazado SII</span>";
    btnLimpiar.addEventListener("click", limpiarTrazadoSII);

    toolsMap.append(btnClick, btnTrazo, bufferDiv, btnLimpiar);
    $("siiBufferSlider").addEventListener("input", function () {
      bufferDistancia = parseInt(this.value, 10);
      $("siiBufferVal").textContent = bufferDistancia;
    });

    const panel = document.createElement("div");
    panel.id = "siiRolesPanel";
    panel.className = "sii-roles-panel";
    panel.innerHTML = `
      <div class="sii-roles-header">
        <b>🏘️ Predios en Servidumbre</b>
        <button type="button" id="siiRolesClose">×</button>
      </div>
      <div id="siiRolesStatus" class="sii-roles-status"></div>
      <div id="siiRolesList" class="sii-roles-list"></div>
      <div class="sii-roles-footer">
        <button type="button" id="siiExportCSV" style="background:#2563eb">⬇️ Exportar CSV</button>
        <button type="button" id="siiAbrirVisor" style="background:#e84229">🔗 Abrir SII</button>
      </div>`;
    document.body.appendChild(panel);
    $("siiRolesClose").addEventListener("click", () => { panel.style.display = "none"; });
    $("siiExportCSV").addEventListener("click", exportarRolesCSV);
    $("siiAbrirVisor").addEventListener("click", () => window.open(SII_VISOR, "_blank", "noopener"));
  }

  function desactivarClickSII() {
    if (herramienta === "sii") herramienta = null;
    window.siiModoActivo = false;
    map.getContainer().classList.remove("cursor-dibujo");
    const b = $("btnToggleSII");
    if (b) { b.classList.remove("active"); b.querySelector("span").textContent = "Activar Click Predios SII"; }
  }

  function toggleModoTrazo() {
    if (herramienta === "trazo") { cancelarDibujo(); terminarModoTrazo(); return; }
    if (consultandoLinea) { mostrarToast("⏳ Espera a que termine la consulta anterior"); return; }
    desactivarHerramientas();
    herramienta = "trazo";
    if (!map.hasLayer(siiLayer)) map.addLayer(siiLayer);
    const btn = $("btnSIITrazo");
    btn.classList.add("active");
    btn.querySelector("span").textContent = "Cancelar Trazo";
    $("siiBufferControl").style.display = "block";
    $("btnLimpiarSII").style.display = "flex";
    iniciarDibujo({
      color: "#e84229",
      alTerminar: (pts, linea) => {
        medicionLayer.removeLayer(linea);
        terminarModoTrazo();
        if (pts.length < 2) { mostrarToast("La línea necesita al menos 2 puntos"); return; }
        L.polyline(pts, { color: "#e84229", weight: 3 }).addTo(siiLayer);
        consultarRolesPorLinea(pts);
      }
    });
    mostrarToast("✏️ Clic para trazar la línea · doble clic para terminar · Esc para cancelar");
  }

  function terminarModoTrazo() {
    if (herramienta === "trazo") herramienta = null;
    const btn = $("btnSIITrazo");
    if (btn) { btn.classList.remove("active"); btn.querySelector("span").textContent = "Trazar Línea Servidumbre"; }
  }

  function limpiarTrazadoSII() {
    if (herramienta === "trazo") cancelarDibujo();
    terminarModoTrazo();
    siiLayer.clearLayers();
    rolesEncontrados = [];
    const panel = $("siiRolesPanel");
    if (panel) panel.style.display = "none";
    $("siiBufferControl").style.display = "none";
    $("btnLimpiarSII").style.display = "none";
  }

  function mostrarPanelRoles() {
    const panel = $("siiRolesPanel");
    const lista = $("siiRolesList");
    if (!panel || !lista) return;
    panel.style.display = "block";
    lista.innerHTML = "";
    if (!rolesEncontrados.length) {
      lista.innerHTML = `<p class="muted sii-empty">Aún no hay predios en la lista.</p>`;
      return;
    }
    rolesEncontrados.forEach((r) => {
      const item = document.createElement("div");
      item.className = "sii-roles-item";
      item.innerHTML = `
        <div><b>Rol ${esc(r.rol)}</b>${r.comuna ? ` · <span class="muted">${esc(r.comuna)}</span>` : ""}
          ${r.direccion ? `<br><span>${esc(r.direccion)}</span>` : ""}
          ${r.avaluo ? `<br><span class="muted">Avalúo: $${r.avaluo.toLocaleString("es-CL")}</span>` : ""}
        </div>`;
      const fila = document.createElement("div");
      fila.className = "popup-btn-row";
      const ir = document.createElement("button");
      ir.type = "button"; ir.textContent = "📍 Ir"; ir.className = "popup-btn small"; ir.style.background = "#64748b";
      ir.addEventListener("click", () => map.flyTo([r.lat, r.lon], 18, { duration: 0.6 }));
      const gm = document.createElement("a");
      gm.href = `https://www.google.com/maps?q=${r.lat},${r.lon}&z=19`;
      gm.target = "_blank"; gm.rel = "noopener";
      gm.textContent = "GMaps"; gm.className = "popup-btn small"; gm.style.background = "#4285f4";
      fila.append(ir, gm);
      item.appendChild(fila);
      lista.appendChild(item);
    });
  }

  function actualizarEstadoPanel(msg, tipo) {
    const el = $("siiRolesStatus");
    if (!el) return;
    el.style.color = { loading: "#f59e0b", success: "#16a34a", error: "#ef4444", info: "#6b7280" }[tipo] || "#666";
    el.textContent = msg;
  }

  function exportarRolesCSV() {
    if (!rolesEncontrados.length) { mostrarToast("No hay predios para exportar"); return; }
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = [["Rol Predial", "Dirección", "Comuna", "Avalúo", "Latitud", "Longitud"]];
    rolesEncontrados.forEach((r) => filas.push([r.rol, r.direccion, r.comuna, r.avaluo ?? "", r.lat.toFixed(6), r.lon.toFixed(6)]));
    const csv = "\uFEFF" + filas.map((f) => f.map(q).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    a.download = `roles_servidumbre_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  window.exportarRolesCSV = exportarRolesCSV;

  // ====================================================
  // TOAST
  // ====================================================
  let toastTimer;
  function mostrarToast(msg) {
    let toast = $("appToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "appToast";
      toast.className = "app-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.opacity = "0"; }, 3500);
  }
  window.mostrarToast = mostrarToast;
  window.renderPanelCapas = renderPanelCapas;

  // ====================================================
  // ARRANQUE
  // ====================================================
  inyectarUISII();
  renderPanelCapas();
  cargarDatos();
  mostrarVersionYAdmin();

  // Fecha de los datos y botón "Actualizar datos" (solo administradores)
  async function mostrarVersionYAdmin() {
    try {
      const r = await fetch("./assets/datos_meta.json", { cache: "no-store" });
      if (r.ok) {
        const m = await r.json();
        const el = document.createElement("div");
        el.className = "datos-version";
        el.textContent = `Datos al ${new Date(m.fecha).toLocaleDateString("es-CL")}`;
        el.title = `Actualizado ${new Date(m.fecha).toLocaleString("es-CL")}${m.autor ? " por " + m.autor : ""}`;
        $("visibleSitesCounter")?.after(el);
      }
    } catch (_) {}
    try {
      const r = await fetch("./api/yo", { cache: "no-store" });
      if (!r.ok) return;
      const yo = await r.json();
      if (!yo.admin) return;
      const a = document.createElement("a");
      a.href = "./actualizar.html";
      a.className = "sidebar-btn";
      a.title = "Actualizar base de datos";
      a.innerHTML = "🔄 <span>Actualizar datos</span>";
      $("toolsMap")?.querySelector("h3")?.after(a);
    } catch (_) {}
  }
})();
