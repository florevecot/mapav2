// ======================================================
// capas.externas.js – Capas de servicios públicos ArcGIS REST
//   · "mapserver": se dibuja como imágenes (ej. redes eléctricas SEC) y
//     se consulta con un clic en el mapa.
//   · "antenas":  sitios de antenas por operadora (ej. SUBTEL). Cada
//     operadora es una capa independiente que se prende y apaga sola.
// Cada capa tiene su botón en la barra lateral y su casilla en "Capas";
// lo que prendas o apagues se recuerda para la próxima visita.
// No usa librerías de Esri ni requiere cuenta: solo lee datos públicos.
// ======================================================

(function () {
  const CFG = window.APP_CONFIG || {};
  const map = window.map;
  if (!map) { console.warn("capas.externas: el mapa no está listo"); return; }

  const PROXY = (CFG.GIS_PROXY_URL || "").trim();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
  const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  const limpiarURL = (u) => String(u || "").split("?")[0].replace(/\/+$/, "");
  const conParams = (base, params) => `${base}${base.includes("?") ? "&" : "?"}${new URLSearchParams(params)}`;
  const viaProxy = (u) => `${PROXY}?url=${encodeURIComponent(u)}`;
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  const PIXEL_VACIO = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const CAMPOS_INTERNOS = /^(OBJECTID|OBJECTID_1|FID|OID|SHAPE.*|GLOBALID|SE_ANNO_CAD_DATA)$/i;
  const aviso = (m) => window.mostrarToast?.(m);

  // ---------- Recordar qué capas están prendidas ----------
  const CLAVE_ESTADO = "capasExternas";
  let estadoGuardado = {};
  try { estadoGuardado = JSON.parse(localStorage.getItem(CLAVE_ESTADO) || "{}") || {}; } catch (_) {}
  function recordar(id, valor) {
    estadoGuardado[id] = valor;
    try { localStorage.setItem(CLAVE_ESTADO, JSON.stringify(estadoGuardado)); } catch (_) {}
  }
  const inicial = (id, porDefecto) => (id in estadoGuardado ? !!estadoGuardado[id] : !!porDefecto);

  // ---------- Peticiones ----------
  // Pasa por el proxy de Cloudflare; si no existe (pruebas en local), intenta directo.
  async function pedirJSON(url) {
    const intentos = PROXY ? [viaProxy(url), url] : [url];
    let ultimo;
    for (const u of intentos) {
      try {
        const r = await fetch(u);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (d && d.error) throw new Error(d.error.message || "Error del servicio");
        return d;
      } catch (err) { ultimo = err; }
    }
    throw ultimo;
  }

  function tablaAtributos(attrs, alias = {}) {
    const filas = Object.entries(attrs || {})
      .filter(([k, v]) => !CAMPOS_INTERNOS.test(k) && v !== null && v !== "" && String(v).toLowerCase() !== "null")
      .map(([k, v]) => `<tr><th>${esc(alias[k] || k)}</th><td>${esc(v)}</td></tr>`).join("");
    return filas ? `<table class="site-popup-table">${filas}</table>` : `<p class="muted">Sin atributos</p>`;
  }

  // ====================================================
  // INTERRUPTORES: una entrada por capa que se puede prender/apagar
  // (los usan los botones de la barra lateral y el panel de capas)
  // ====================================================
  const interruptores = [];   // { id, nombre, icono, color, activo(), set(v) }
  const botones = new Map();  // id -> botón de la barra lateral

  function sincronizar(id) {
    const it = interruptores.find((x) => x.id === id);
    const b = botones.get(id);
    if (it && b) b.classList.toggle("active", it.activo());
    refrescarPanel();
  }

  // ====================================================
  // CAPA MAPSERVER (imágenes + identificar)
  // ====================================================
  class CapaMapServer {
    constructor(cfg) {
      this.cfg = cfg;
      this.id = cfg.id || "mapserver";
      this.url = limpiarURL(cfg.url);
      this.subcapas = [];
      this.visibles = new Set();
      this.leyenda = new Map();
      this.activa = inicial(this.id, cfg.visibleInicial);
      this.estado = "cargando";
      this.error = "";
      this.imagenesViaProxy = !!cfg.imagenesViaProxy;
      const self = this;

      // Teselas de 512 px generadas con la operación "export" del servicio
      const Teselas = L.TileLayer.extend({
        getTileUrl(c) { return self.urlTesela(c, this.getTileSize().x); }
      });
      this.teselas = new Teselas("", {
        tileSize: 512, zoomOffset: -1, minZoom: 1, maxZoom: 20,
        opacity: cfg.opacidad ?? 0.85, attribution: cfg.atribucion || "", className: "capa-externa"
      });
      // Si el servidor no entrega imágenes directo, se piden a través del proxy
      let errores = 0;
      this.teselas.on("tileerror", () => {
        if (!self.imagenesViaProxy && PROXY && ++errores >= 3) {
          self.imagenesViaProxy = true;
          console.info(`${cfg.nombre}: imágenes vía proxy`);
          self.teselas.redraw();
        }
      });

      interruptores.push({
        id: this.id, nombre: cfg.nombre, icono: cfg.icono || "🗺️", color: null,
        activo: () => this.activa,
        set: (v) => this.setActiva(v)
      });
      this.iniciar();
    }

    async iniciar() {
      try {
        const info = await pedirJSON(`${this.url}?f=json`);
        this.subcapas = (info.layers || []).map((l) => ({
          id: l.id, nombre: l.name, padre: l.parentLayerId ?? -1,
          hijos: l.subLayerIds || [], visibleDefecto: l.defaultVisibility !== false
        }));
        const iniciales = this.cfg.capasIniciales;
        this.subcapas.filter((s) => !s.hijos.length).forEach((s) => {
          if (Array.isArray(iniciales) ? iniciales.includes(s.id) : s.visibleDefecto) this.visibles.add(s.id);
        });
        this.estado = "listo";
        pedirJSON(`${this.url}/legend?f=json`).then((lg) => {
          (lg.layers || []).forEach((l) => this.leyenda.set(l.layerId, l.legend || []));
          refrescarPanel();
        }).catch(() => {});
        if (this.activa) map.addLayer(this.teselas);
      } catch (err) {
        console.error(`${this.cfg.nombre}:`, err);
        this.estado = "error";
        this.error = err.message;
      }
      refrescarPanel();
    }

    urlTesela(c, T) {
      if (!this.visibles.size) return PIXEL_VACIO;
      const R = 20037508.342789244;
      const res = (2 * R) / (T * Math.pow(2, c.z));
      const xmin = -R + c.x * T * res, xmax = xmin + T * res;
      const ymax = R - c.y * T * res, ymin = ymax - T * res;
      const u = conParams(`${this.url}/export`, {
        bbox: `${xmin},${ymin},${xmax},${ymax}`, bboxSR: 3857, imageSR: 3857,
        size: `${T},${T}`, dpi: 96, format: "png32", transparent: true,
        layers: `show:${[...this.visibles].join(",")}`, f: "image"
      });
      return this.imagenesViaProxy ? viaProxy(u) : u;
    }

    setActiva(v) {
      this.activa = v;
      recordar(this.id, v);
      if (v && this.estado === "listo") map.addLayer(this.teselas); else map.removeLayer(this.teselas);
      if (v && this.estado === "error") aviso(`⚠️ ${this.cfg.nombre}: no se pudo conectar al servicio`);
      sincronizar(this.id);
    }

    setSubcapa(id, v) {
      this.hojasDe(id).forEach((h) => (v ? this.visibles.add(h) : this.visibles.delete(h)));
      this.teselas.redraw();
    }

    hojasDe(id) {
      const s = this.subcapas.find((x) => x.id === id);
      if (!s) return [];
      if (!s.hijos.length) return [id];
      return s.hijos.flatMap((h) => this.hojasDe(h));
    }

    async identificar(latlng) {
      if (!this.activa || this.estado !== "listo" || !this.visibles.size) return [];
      const b = map.getBounds(), s = map.getSize();
      const d = await pedirJSON(conParams(`${this.url}/identify`, {
        geometry: `${latlng.lng},${latlng.lat}`, geometryType: "esriGeometryPoint", sr: 4326,
        layers: `visible:${[...this.visibles].join(",")}`, tolerance: 6,
        mapExtent: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`,
        imageDisplay: `${s.x},${s.y},96`, returnGeometry: false, f: "json"
      }));
      return (d.results || []).slice(0, 10).map((r) => ({ titulo: `${this.cfg.nombre} · ${r.layerName}`, atributos: r.attributes }));
    }

    renderPanel(cont) {
      const sec = document.createElement("div");
      sec.className = "ext-seccion";
      sec.appendChild(filaInterruptor(interruptores.find((x) => x.id === this.id), "ext-principal"));
      cont.appendChild(sec);

      if (this.estado === "cargando") { sec.insertAdjacentHTML("beforeend", `<p class="muted">Cargando capas del servicio…</p>`); return; }
      if (this.estado === "error") { sec.insertAdjacentHTML("beforeend", `<p class="muted">No se pudo conectar (${esc(this.error)}).</p>`); return; }

      const op = document.createElement("label");
      op.className = "ext-opacidad";
      op.innerHTML = `Opacidad <input type="range" min="0.2" max="1" step="0.05" value="${this.teselas.options.opacity}">`;
      op.querySelector("input").addEventListener("input", (e) => this.teselas.setOpacity(parseFloat(e.target.value)));
      sec.appendChild(op);

      const det = document.createElement("details");
      det.className = "ext-detalle";
      det.open = this.panelAbierto ?? false;
      det.addEventListener("toggle", () => { this.panelAbierto = det.open; });
      det.innerHTML = `<summary>Subcapas (${this.subcapas.filter((s) => !s.hijos.length).length})</summary>`;
      const lista = document.createElement("div");
      lista.className = "ext-subcapas";
      const nivel = (s) => { let n = 0, p = s.padre; while (p !== -1 && n < 5) { n++; p = this.subcapas.find((x) => x.id === p)?.padre ?? -1; } return n; };
      this.subcapas.forEach((s) => {
        const label = document.createElement("label");
        label.className = "filter-item ext-subcapa";
        label.style.paddingLeft = `${nivel(s) * 14}px`;
        const cb = document.createElement("input");
        cb.type = "checkbox";
        const hojas = this.hojasDe(s.id);
        cb.checked = hojas.length > 0 && hojas.every((h) => this.visibles.has(h));
        cb.indeterminate = !cb.checked && hojas.some((h) => this.visibles.has(h));
        cb.addEventListener("change", () => { this.setSubcapa(s.id, cb.checked); refrescarPanel(); });
        label.appendChild(cb);
        const ley = this.leyenda.get(s.id) || [];
        if (!s.hijos.length && ley.length === 1 && ley[0].imageData) {
          const img = document.createElement("img");
          img.className = "ext-leyenda";
          img.src = `data:${ley[0].contentType || "image/png"};base64,${ley[0].imageData}`;
          img.alt = "";
          label.appendChild(img);
        }
        const txt = document.createElement("span");
        txt.textContent = s.nombre;
        if (s.hijos.length) txt.className = "ext-grupo";
        label.appendChild(txt);
        lista.appendChild(label);
        // Leyendas con varias clases (ej. por tensión)
        if (!s.hijos.length && ley.length > 1) {
          const ul = document.createElement("div");
          ul.className = "ext-leyenda-lista";
          ul.style.paddingLeft = `${nivel(s) * 14 + 24}px`;
          ley.slice(0, 12).forEach((it) => {
            ul.insertAdjacentHTML("beforeend",
              `<div>${it.imageData ? `<img class="ext-leyenda" alt="" src="data:${esc(it.contentType || "image/png")};base64,${esc(it.imageData)}">` : ""}<span>${esc(it.label || "")}</span></div>`);
          });
          lista.appendChild(ul);
        }
      });
      det.appendChild(lista);
      sec.appendChild(det);
    }
  }

  // ====================================================
  // CAPA ANTENAS: cada operadora es una capa independiente
  // ====================================================
  const ORDEN_TEC = (t) => { const m = String(t).match(/(\d)\s*G/i); return m ? parseInt(m[1], 10) : 99; };
  const COLORES_EXTRA = ["#f59e0b", "#0891b2", "#be185d", "#4d7c0f", "#7c2d12", "#475569"];

  class CapaAntenas {
    constructor(cfg) {
      this.cfg = cfg;
      this.id = cfg.id || "antenas";
      // Un servicio por operadora (SUBTEL) o un único servicio con la operadora en un campo
      const lista = Array.isArray(cfg.servicios) && cfg.servicios.length
        ? cfg.servicios
        : (cfg.url ? [{ url: cfg.url, operadora: null }] : []);
      this.grupo = L.layerGroup();
      this.registros = new Map();
      this.operadoras = new Map();   // clave -> { id, nombre, color, icono, activa, n }
      this.tecnologias = new Map();  // tec -> activa
      this.cargando = false;
      this.pendiente = false;
      this.elEstado = null;

      this.servicios = lista.filter((s) => s.url).map((s) => {
        const clave = s.operadora ? normalizar(s.operadora) : null;
        if (clave) this.registrarOperadora(clave, s);
        return { url: limpiarURL(s.url), operadora: clave, zonas: [], campos: null, alias: {}, error: "" };
      });
      this.mensaje = this.servicios.length ? "" : "Falta configurar los servicios en js/config.js (CAPAS_EXTERNAS → antenas).";

      map.on("moveend", debounce(() => this.actualizar(), 400));
      if (this.algunaActiva()) { map.addLayer(this.grupo); setTimeout(() => this.actualizar(), 0); }
    }

    registrarOperadora(clave, s = {}) {
      if (this.operadoras.has(clave)) return this.operadoras.get(clave);
      const id = `${this.id}:${s.id || clave.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const op = {
        id, clave,
        nombre: s.operadora || clave,
        color: s.color || COLORES_EXTRA[this.operadoras.size % COLORES_EXTRA.length],
        icono: s.icono || "📡",
        activa: inicial(id, s.visible),
        n: 0
      };
      this.operadoras.set(clave, op);
      interruptores.push({
        id, nombre: op.nombre, icono: op.icono, color: op.color, grupo: this.cfg.nombre,
        activo: () => op.activa,
        set: (v) => this.setOperadora(clave, v)
      });
      return op;
    }

    algunaActiva() { return [...this.operadoras.values()].some((o) => o.activa) || (!this.operadoras.size && this.servicios.length > 0); }

    setOperadora(clave, v) {
      const op = this.operadoras.get(clave);
      if (!op) return;
      op.activa = v;
      recordar(op.id, v);
      if (this.algunaActiva()) {
        map.addLayer(this.grupo);
        if (v) {
          const zMin = this.cfg.zoomMinimo ?? 10;
          if (map.getZoom() < zMin) aviso(`📡 Acerca el mapa (zoom ${zMin} o más) para ver las antenas de ${op.nombre}`);
          this.actualizar();
        } else this.dibujar();
      } else {
        this.grupo.clearLayers();
        map.removeLayer(this.grupo);
      }
      sincronizar(op.id);
    }

    setEstado(msg) {
      this.mensaje = msg;
      if (this.elEstado) this.elEstado.textContent = msg;
    }

    async actualizar() {
      if (!this.servicios.length || !this.algunaActiva()) return;
      const zMin = this.cfg.zoomMinimo ?? 10;
      if (map.getZoom() < zMin) {
        this.grupo.clearLayers();
        this.setEstado(`Acerca el mapa para ver antenas (zoom ${map.getZoom()} de ${zMin}).`);
        return;
      }
      await this.cargar(map.getBounds().pad(0.2));
      this.dibujar();
    }

    // Busca el nombre real de un campo por nombre o alias
    resolverCampos(s, fields, aliases) {
      const lista = (fields && fields.length)
        ? fields.map((f) => ({ name: f.name, alias: f.alias || f.name }))
        : Object.entries(aliases || {}).map(([name, alias]) => ({ name, alias }));
      s.alias = Object.fromEntries(lista.map((f) => [f.name, f.alias]));
      const campos = {};
      Object.entries(this.cfg.campos || {}).forEach(([clave, cands]) => {
        const opciones = (Array.isArray(cands) ? cands : [cands]).map(normalizar);
        const f = lista.find((x) => opciones.includes(normalizar(x.name))) ||
                  lista.find((x) => opciones.includes(normalizar(x.alias)));
        campos[clave] = f ? f.name : (Array.isArray(cands) ? cands[0] : cands);
      });
      s.campos = campos;
    }

    async cargar(b) {
      if (this.cargando) { this.pendiente = true; return; }
      // Solo se descargan las operadoras prendidas y las zonas que aún no se tienen
      const pendientes = this.servicios.filter((s) => {
        const op = s.operadora ? this.operadoras.get(s.operadora) : null;
        return (!op || op.activa) && !s.zonas.some((z) => z.contains(b));
      });
      if (!pendientes.length) return;
      this.cargando = true;
      const nombres = pendientes.map((s) => this.operadoras.get(s.operadora)?.nombre || "servicio").join(", ");
      this.setEstado(`Descargando antenas (${nombres})…`);
      const antes = this.registros.size;
      await Promise.all(pendientes.map((s) => this.cargarServicio(s, b)));
      this.cargando = false;
      const errores = pendientes.filter((s) => s.error);
      this.setEstado(errores.length
        ? `Error en ${errores.map((s) => this.operadoras.get(s.operadora)?.nombre || "servicio").join(", ")}: ${errores[0].error}`
        : `${this.registros.size.toLocaleString("es-CL")} registros cargados.`);
      if (this.registros.size !== antes) refrescarPanel();
      if (this.pendiente) { this.pendiente = false; setTimeout(() => this.actualizar(), 0); }
    }

    async cargarServicio(s, b) {
      const pagina = this.cfg.registrosPorPagina || 2000;
      s.error = "";
      try {
        let offset = 0;
        for (let i = 0; i < 40; i++) {
          const d = await pedirJSON(conParams(`${s.url}/query`, {
            where: this.cfg.filtro || "1=1",
            geometry: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`,
            geometryType: "esriGeometryEnvelope", inSR: 4326, spatialRel: "esriSpatialRelIntersects",
            outFields: "*", returnGeometry: true, outSR: 4326,
            resultOffset: offset, resultRecordCount: pagina, f: "json"
          }));
          if (!s.campos) this.resolverCampos(s, d.fields, d.fieldAliases);
          const oid = d.objectIdFieldName || (d.fields || []).find((f) => f.type === "esriFieldTypeOID")?.name || "OBJECTID";
          const feats = d.features || [];
          feats.forEach((f) => this.agregar(f, oid, s));
          if (!d.exceededTransferLimit || !feats.length) break;
          offset += feats.length;
        }
        s.zonas.push(b);
        if (s.zonas.length > 60) s.zonas.shift();
      } catch (err) {
        console.error(`${this.cfg.nombre} (${s.operadora || s.url}):`, err);
        s.error = err.message;
      }
    }

    numero(v) { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; }

    agregar(f, oidCampo, s) {
      const a = f.attributes || {};
      const F = s.campos || {};
      const lat = Number.isFinite(f.geometry?.y) ? f.geometry.y : this.numero(a[F.latitud]);
      const lon = Number.isFinite(f.geometry?.x) ? f.geometry.x : this.numero(a[F.longitud]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const empresa = s.operadora || normalizar(a[F.empresa]) || "SIN EMPRESA";
      const tec = normalizar(a[F.tecnologia]) || "S/I";
      const clave = `${s.url}|${a[oidCampo] ?? `${lat}|${lon}|${a[F.estacion]}|${tec}`}`;
      if (this.registros.has(clave)) return;
      this.registros.set(clave, { lat, lon, empresa, tec, a, s });
      const op = this.registrarOperadora(empresa, { operadora: empresa, visible: true });
      op.n++;
      if (!this.tecnologias.has(tec)) this.tecnologias.set(tec, true);
    }

    campo(r, clave) { return r.a[(r.s.campos || {})[clave]]; }

    // Agrupa: ubicación → operadora → tecnologías / estaciones
    dibujar() {
      this.grupo.clearLayers();
      if (map.getZoom() < (this.cfg.zoomMinimo ?? 10)) return;
      const vista = map.getBounds().pad(0.3);
      const ubic = new Map();
      for (const r of this.registros.values()) {
        if (!vista.contains([r.lat, r.lon])) continue;
        const k = `${r.lat.toFixed(5)},${r.lon.toFixed(5)}`;
        if (!ubic.has(k)) ubic.set(k, { lat: r.lat, lon: r.lon, ops: new Map() });
        const u = ubic.get(k);
        if (!u.ops.has(r.empresa)) u.ops.set(r.empresa, { tecs: new Set(), estaciones: new Set(), registros: [] });
        const o = u.ops.get(r.empresa);
        o.tecs.add(r.tec);
        const est = this.campo(r, "estacion");
        if (est) o.estaciones.add(String(est));
        o.registros.push(r);
      }
      let sitios = 0;
      ubic.forEach((u) => {
        const visibles = [...u.ops.entries()]
          .filter(([emp, o]) => this.operadoras.get(emp)?.activa && [...o.tecs].some((t) => this.tecnologias.get(t)))
          .sort((x, y) => x[0].localeCompare(y[0]));
        if (!visibles.length) return;
        sitios++;
        const n = visibles.length;
        visibles.forEach(([emp], i) => {
          // Varias operadoras en el mismo punto: anillos concéntricos
          const m = L.circleMarker([u.lat, u.lon], {
            radius: 5 + 3.5 * (n - 1 - i), color: "#ffffff", weight: 1.5,
            fillColor: this.operadoras.get(emp).color, fillOpacity: 0.95
          });
          m.bindTooltip(visibles.map(([e, o]) =>
            `${esc(this.operadoras.get(e).nombre)}: ${[...o.tecs].sort((p, q) => ORDEN_TEC(p) - ORDEN_TEC(q)).map(esc).join(" · ")}`
          ).join("<br>"), { direction: "top", offset: [0, -6] });
          m.on("click", (e) => {
            if (window.herramientaActiva?.()) return;
            L.DomEvent.stopPropagation(e);
            this.popup(u, visibles);
          });
          m.addTo(this.grupo);
        });
      });
      if (!this.cargando && !this.servicios.some((s) => s.error)) {
        this.setEstado(`${sitios.toLocaleString("es-CL")} sitios en pantalla · ${this.registros.size.toLocaleString("es-CL")} registros cargados.`);
      }
    }

    popup(u, visibles) {
      const r0 = visibles[0][1].registros[0];
      const ubicacion = [this.campo(r0, "direccion"), this.campo(r0, "comuna"), this.campo(r0, "region")].filter(Boolean).map(esc).join(" · ");
      const bloques = visibles.map(([emp, o]) => {
        const op = this.operadoras.get(emp);
        const tecs = [...o.tecs].sort((p, q) => ORDEN_TEC(p) - ORDEN_TEC(q))
          .map((t) => `<span class="tec-badge">${esc(t)}</span>`).join("");
        const est = [...o.estaciones].map(esc).join(", ");
        const periodo = [...new Set(o.registros.map((r) => this.campo(r, "periodo")).filter(Boolean))].map(esc).join(", ");
        const detalle = o.registros.map((r) => `<div class="ext-registro"><b>${esc(r.tec)}</b>${tablaAtributos(r.a, r.s.alias)}</div>`).join("");
        return `<div class="ant-op">
            <div class="ant-op-titulo"><span class="estado-swatch" style="background:${esc(op.color)}"></span><b>${esc(op.nombre)}</b></div>
            <div class="ant-tecs">${tecs}</div>
            ${est ? `<div class="muted">Estación: ${est}</div>` : ""}
            ${periodo ? `<div class="muted">Período: ${periodo}</div>` : ""}
            <details><summary>Ver ${o.registros.length} registro(s)</summary>${detalle}</details>
          </div>`;
      }).join("");
      const html = `<div class="site-popup">
          <div class="site-popup-title"><b>📡 Sitio con ${visibles.length} operadora(s)</b></div>
          ${ubicacion ? `<div class="muted">${ubicacion}</div>` : ""}
          <div class="muted">${u.lat.toFixed(6)}, ${u.lon.toFixed(6)} ·
            <a href="https://www.google.com/maps?q=${u.lat},${u.lon}&z=18" target="_blank" rel="noopener">Google Maps</a></div>
          ${bloques}
        </div>`;
      L.popup({ maxWidth: 380, minWidth: 260, maxHeight: 420 }).setLatLng([u.lat, u.lon]).setContent(html).openOn(map);
    }

    renderPanel(cont) {
      const sec = document.createElement("div");
      sec.className = "ext-seccion";
      sec.insertAdjacentHTML("beforeend", `<div class="ext-principal">${esc(this.cfg.icono || "📡")} ${esc(this.cfg.nombre)}</div>`);
      this.elEstado = document.createElement("p");
      this.elEstado.className = "muted ext-estado";
      this.elEstado.textContent = this.mensaje || (this.algunaActiva() ? "" : "Prende una o más operadoras para ver sus antenas.");
      sec.appendChild(this.elEstado);
      cont.appendChild(sec);
      if (!this.servicios.length) return;

      // Una casilla por operadora (cada una es una capa independiente)
      [...this.operadoras.values()].forEach((op) => {
        const it = interruptores.find((x) => x.id === op.id);
        const fila = filaInterruptor(it);
        if (op.n) fila.querySelector(".int-nombre").textContent += ` (${op.n.toLocaleString("es-CL")})`;
        sec.appendChild(fila);
      });

      if (this.tecnologias.size) {
        const t2 = document.createElement("div");
        t2.className = "ext-titulo";
        t2.textContent = "Tecnologías";
        sec.appendChild(t2);
        const fila = document.createElement("div");
        fila.className = "ext-tecs-filtro";
        [...this.tecnologias.entries()].sort((a, b) => ORDEN_TEC(a[0]) - ORDEN_TEC(b[0]) || a[0].localeCompare(b[0])).forEach(([tec, act]) => {
          const label = document.createElement("label");
          label.className = "tec-check";
          label.innerHTML = `<input type="checkbox" ${act ? "checked" : ""}><span>${esc(tec)}</span>`;
          label.querySelector("input").addEventListener("change", (e) => { this.tecnologias.set(tec, e.target.checked); this.dibujar(); });
          fila.appendChild(label);
        });
        sec.appendChild(fila);
      }
    }
  }

  // ====================================================
  // UI COMPARTIDA
  // ====================================================
  function filaInterruptor(it, claseExtra = "") {
    const label = document.createElement("label");
    label.className = `filter-item ${claseExtra}`.trim();
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = it.activo();
    cb.addEventListener("change", () => it.set(cb.checked));
    label.appendChild(cb);
    if (it.color) {
      const sw = document.createElement("span");
      sw.className = "estado-swatch";
      sw.style.background = it.color;
      label.appendChild(sw);
    }
    const span = document.createElement("span");
    span.className = "int-nombre";
    span.textContent = it.color ? it.nombre : `${it.icono} ${it.nombre}`;
    label.appendChild(span);
    return label;
  }

  // Botones de la barra lateral: uno por capa
  function crearBotonesBarra() {
    const tools = document.getElementById("toolsMap");
    if (!tools || !interruptores.length) return;
    const caja = document.createElement("div");
    caja.id = "capasExternasBotones";
    caja.innerHTML = `<h3>Capas externas</h3>`;
    let grupoActual = null;
    interruptores.forEach((it) => {
      if (it.grupo && it.grupo !== grupoActual) {
        grupoActual = it.grupo;
        const sub = document.createElement("div");
        sub.className = "sidebar-subtitulo";
        sub.textContent = it.grupo;
        caja.appendChild(sub);
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sidebar-btn ext-btn";
      b.title = `Prender / apagar: ${it.nombre}`;
      b.innerHTML = `${esc(it.icono)} <span>${esc(it.nombre)}</span>`;
      b.classList.toggle("active", it.activo());
      b.addEventListener("click", () => it.set(!it.activo()));
      botones.set(it.id, b);
      caja.appendChild(b);
    });
    const subida = tools.querySelector(".upload-section");
    tools.insertBefore(caja, subida || null);
  }

  // ====================================================
  // CREAR CAPAS, PANEL E IDENTIFICACIÓN
  // ====================================================
  const capas = (CFG.CAPAS_EXTERNAS || []).map((c) => {
    if (c.tipo === "mapserver" && c.url) return new CapaMapServer(c);
    if (c.tipo === "antenas") return new CapaAntenas(c);
    return null;
  }).filter(Boolean);

  const refrescarPanel = debounce(() => window.renderPanelCapas?.(), 50);

  let consultaId = 0;
  async function identificar(latlng) {
    const conMapServer = capas.filter((c) => c instanceof CapaMapServer && c.activa && c.visibles.size);
    if (!conMapServer.length) return;
    const id = ++consultaId;
    const resultados = (await Promise.allSettled(conMapServer.map((c) => c.identificar(latlng))))
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    if (id !== consultaId || !resultados.length) return;
    const html = `<div class="site-popup">${resultados.map((r, i) =>
      `<details ${i === 0 ? "open" : ""} class="ext-resultado"><summary><b>${esc(r.titulo)}</b></summary>${tablaAtributos(r.atributos)}</details>`
    ).join("")}</div>`;
    L.popup({ maxWidth: 380, minWidth: 260, maxHeight: 420 }).setLatLng(latlng).setContent(html).openOn(map);
  }

  window.CapasExternas = {
    capas,
    interruptores,
    // Prender/apagar desde código: CapasExternas.set("antenas:entel", true)
    set(id, valor) { interruptores.find((x) => x.id === id)?.set(valor); },
    renderEnPanel(cont) {
      if (!capas.length) return;
      const h = document.createElement("h4");
      h.className = "panel-subtitle";
      h.textContent = "Capas externas";
      cont.appendChild(h);
      capas.forEach((c) => c.renderPanel(cont));
    },
    identificar
  };

  crearBotonesBarra();
  refrescarPanel();
})();
