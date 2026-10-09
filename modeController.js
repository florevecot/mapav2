// ======================================================
// modeController.js – Cambio MAPA <-> GRAFO
// ======================================================

(function () {
  window.APP_STATE = window.APP_STATE || { mode: "map", showingSubgraph: false, selectedNode: null };

  const byId = (id) => document.getElementById(id);
  let grafoCargado = false;
  let grafoCargando = null;

  function setLoading(visible, texto) {
    const el = byId("loadingIndicator");
    if (!el) return;
    if (texto) el.querySelector("span").textContent = texto;
    el.style.display = visible ? "flex" : "none";
  }

  function marcarBotones(modo) {
    byId("modeMap")?.classList.toggle("active", modo === "map");
    byId("modeGraph")?.classList.toggle("active", modo === "graph");
  }

  async function cargarGrafo() {
    if (grafoCargado) return true;
    if (grafoCargando) return grafoCargando;

    grafoCargando = (async () => {
      setLoading(true, "Cargando grafo de dependencias...");
      try {
        if (typeof window.loadSigmaNetwork !== "function") {
          throw new Error("loadSigmaNetwork no está disponible (revisa que sigma.js cargue)");
        }
        const url = window.APP_CONFIG?.GRAPH_URL || "./assets/sigma_mapa.json";
        const data = await window.cargarJSON(url);
        window.loadSigmaNetwork(data);
        grafoCargado = true;
        return true;
      } catch (err) {
        console.error("❌ Error cargando el grafo:", err);
        alert("No se pudo cargar el grafo de dependencias.\n" + err.message);
        return false;
      } finally {
        setLoading(false);
        grafoCargando = null;
      }
    })();

    return grafoCargando;
  }

  async function activarGrafo() {
    window.APP_STATE.mode = "graph";
    document.body.classList.replace("mode-map", "mode-graph");
    byId("viewDiv")?.classList.add("hidden");
    byId("graphDiv")?.classList.remove("hidden");
    byId("toolsMap")?.classList.add("hidden");
    byId("toolsGraph")?.classList.remove("hidden");
    marcarBotones("graph");

    const ok = await cargarGrafo();
    if (ok) {
      // Sigma necesita recalcular tamaño cuando el contenedor pasa de oculto a visible
      try { window.sigmaInstance?.resize?.(); window.sigmaInstance?.refresh?.(); } catch (_) {}
    }
  }

  function activarMapa() {
    window.APP_STATE.mode = "map";
    document.body.classList.replace("mode-graph", "mode-map");
    byId("graphDiv")?.classList.add("hidden");
    byId("viewDiv")?.classList.remove("hidden");
    byId("toolsGraph")?.classList.add("hidden");
    byId("toolsMap")?.classList.remove("hidden");
    marcarBotones("map");
    // Leaflet necesita recalcular el tamaño cuando el contenedor vuelve a mostrarse
    setTimeout(() => window.map?.invalidateSize(), 0);
  }

  document.addEventListener("DOMContentLoaded", () => {
    byId("modeGraph")?.addEventListener("click", activarGrafo);
    byId("modeMap")?.addEventListener("click", activarMapa);
    activarMapa();
  });

  window.activarGrafo = activarGrafo;
  window.activarMapa = activarMapa;
})();
