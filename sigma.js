// ======================================================
// sigma.js – Construcción y render del grafo (Sigma v2 + Graphology)
// ======================================================

(function () {
  window.APP_STATE = window.APP_STATE || { showingSubgraph: false, selectedNode: null };
  window.sigmaGraph = null;
  window.sigmaInstance = null;

  const NODE_SIZE = 3;
  const EDGE_COLOR = "#334155";

  function getSigmaCtor() {
    if (typeof window.Sigma === "function") return window.Sigma;
    if (window.sigma && typeof window.sigma.Sigma === "function") return window.sigma.Sigma;
    throw new Error("Sigma no encontrado. Revisa el <script> de sigma en index.html.");
  }

  function colorPorEnergia(v) {
    if (v === null || v === undefined || String(v).trim() === "") return "#64748b"; // sin dato
    if (typeof v === "number") return v === 1 ? "#22c55e" : "#ef4444";
    if (typeof v === "boolean") return v ? "#22c55e" : "#ef4444";
    const t = String(v).toLowerCase();
    if (t.includes("ok")) return "#22c55e";
    return "#ef4444";
  }

  function parseNetworkJSON(data) {
    if (data && Array.isArray(data.nodes)) {
      return { nodes: data.nodes, edges: Array.isArray(data.edges) ? data.edges : [] };
    }
    if (Array.isArray(data)) return { nodes: data, edges: [] };
    throw new Error("JSON no reconocido (se esperaba {nodes, edges} o un array)");
  }

  // FIX: el JSON real trae el ID en "Nemonico"; antes no se leía y el grafo quedaba vacío.
  function getNodeId(n) {
    return String(
      n?.id ??
      n?.Nemonico ??
      n?.["ID Sitio"] ??
      n?.attributes?.["ID Sitio"] ??
      n?.data?.["ID Sitio"] ??
      n?.data?.id ??
      ""
    ).trim();
  }

  function getEnergia(n) {
    return (
      n?.["Estatus OOEE NF"] ??
      n?.data?.["Estatus OOEE NF"] ??
      n?.attributes?.["Estatus OOEE NF"] ??
      n?.energia ??
      n?.data?.energia ??
      null
    );
  }

  // Posición: si el sitio tiene coordenadas se ubica según su geografía (lat/long),
  // así el grafo "se parece" a Chile y los vecinos quedan cerca. Si no, va a una
  // columna aparte al costado derecho.
  function calcularPosicion(n, idx) {
    const lat = parseFloat(n?.Lat ?? n?.lat);
    const lon = parseFloat(n?.Long ?? n?.lon ?? n?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) {
      // pequeño jitter para separar sitios con la misma coordenada
      const jx = (Math.random() - 0.5) * 0.004;
      const jy = (Math.random() - 0.5) * 0.004;
      return { x: lon * Math.cos(35 * Math.PI / 180) + jx, y: lat + jy, geo: true };
    }
    return { x: -50 + (idx % 20) * 0.25, y: -20 - Math.floor(idx / 20) * 0.25, geo: false };
  }

  function waitForGraphDivReady(cb, tries = 0) {
    const el = document.getElementById("graphDiv");
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width > 50 && r.height > 50) cb();
    else if (tries < 120) requestAnimationFrame(() => waitForGraphDivReady(cb, tries + 1));
    else console.warn("graphDiv nunca tomó tamaño");
  }

  window.loadSigmaNetwork = function (data) {
    const container = document.getElementById("graphDiv");
    if (!container) { console.error("graphDiv no existe"); return; }
    container.style.background = "#0f172a";

    const { nodes, edges } = parseNetworkJSON(data);
    const graph = new graphology.Graph({ type: "directed", multi: false });

    let sinCoords = 0;
    for (const n of nodes) {
      const id = getNodeId(n);
      if (!id || graph.hasNode(id)) continue;
      const pos = calcularPosicion(n, sinCoords);
      if (!pos.geo) sinCoords++;
      const energia = getEnergia(n);
      const color = colorPorEnergia(energia);
      graph.addNode(id, {
        label: id,
        x: pos.x,
        y: pos.y,
        size: NODE_SIZE,
        color,
        baseColor: color,
        baseSize: NODE_SIZE,
        energia,
        raw: n
      });
    }

    for (const e of edges) {
      const from = String(e?.source ?? e?.from ?? e?.a ?? "").trim();
      const to = String(e?.target ?? e?.to ?? e?.b ?? "").trim();
      if (!from || !to || from === to) continue;
      if (!graph.hasNode(from) || !graph.hasNode(to)) continue;
      if (graph.hasEdge(from, to)) continue;
      graph.addEdge(from, to, { size: 0.6, color: EDGE_COLOR });
    }

    if (window.sigmaInstance) {
      try { window.sigmaInstance.kill(); } catch (_) {}
    }

    window.sigmaGraph = graph;
    const SigmaCtor = getSigmaCtor();
    window.sigmaInstance = new SigmaCtor(graph, container, {
      labelColor: { color: "#e2e8f0" },
      labelRenderedSizeThreshold: 6,
      defaultEdgeType: "line",
      zIndex: true
    });

    window.APP_STATE.showingSubgraph = false;
    window.APP_STATE.selectedNode = null;

    waitForGraphDivReady(() => {
      window.sigmaInstance.resize();
      window.sigmaResetView(false);
    });

    console.log("✅ Sigma listo", { nodos: graph.order, aristas: graph.size, sinCoordenadas: sinCoords });
    window.graphController?.onGraphReady?.();
  };

  // ------------------------------------------------------------------
  // CÁMARA
  // FIX: la cámara de Sigma v2 trabaja en coordenadas normalizadas (0..1),
  // no en las coordenadas crudas del grafo. Antes se le pasaban coordenadas
  // crudas y la vista quedaba fuera de pantalla.
  // ------------------------------------------------------------------
  function animar(state, duration = 600) {
    const cam = window.sigmaInstance?.getCamera();
    if (!cam) return;
    if (duration > 0) cam.animate(state, { duration, easing: "quadraticOut" });
    else cam.setState(state);
  }

  window.sigmaFocusNode = function (id, ratio = 0.08) {
    const s = window.sigmaInstance;
    if (!s || !window.sigmaGraph?.hasNode(id)) return;
    const d = s.getNodeDisplayData(id);
    if (!d) return;
    animar({ x: d.x, y: d.y, ratio });
  };

  // Encuadra un conjunto de nodos (por ejemplo, el subgrafo visible)
  window.sigmaFitNodes = function (ids) {
    const s = window.sigmaInstance;
    if (!s) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const d = s.getNodeDisplayData(id);
      if (!d) continue;
      minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x);
      minY = Math.min(minY, d.y); maxY = Math.max(maxY, d.y);
    }
    if (!Number.isFinite(minX)) return;
    const spread = Math.max(maxX - minX, maxY - minY);
    const ratio = Math.min(1.2, Math.max(0.02, spread * 1.4));
    animar({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, ratio });
  };

  window.sigmaResetView = function (animated = true) {
    if (!window.sigmaInstance) return;
    animar({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }, animated ? 500 : 0);
  };
})();
