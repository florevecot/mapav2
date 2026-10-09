// ======================================================
// ui.sidebar.js – Barra lateral y apertura/cierre de paneles
// (La lógica de búsqueda y filtros vive SOLO en app.map.js;
//  antes estaba duplicada aquí y se pisaban entre sí.)
// ======================================================

(function () {
  const $ = (id) => document.getElementById(id);

  const PANELES = [
    { panel: "layersPanel", boton: "toggleLayersPanel", cerrar: "closeLayersPanel" },
    { panel: "basemapPanel", boton: "toggleBasemapPanel", cerrar: "closeBasemapPanel" },
    { panel: "nemonicoFilterPanel", boton: "toggleNemonicoFilter", cerrar: "closeNemonicoFilter" }
  ];

  function cerrarPanel(panelId) {
    const cfg = PANELES.find((p) => p.panel === panelId);
    $(panelId)?.classList.remove("open");
    if (cfg) $(cfg.boton)?.classList.remove("active");
  }

  function cerrarTodos() {
    PANELES.forEach((p) => cerrarPanel(p.panel));
  }

  function abrirPanel(panelId) {
    const cfg = PANELES.find((p) => p.panel === panelId);
    cerrarTodos();
    $(panelId)?.classList.add("open");
    if (cfg) $(cfg.boton)?.classList.add("active");
    window.dispatchEvent(new CustomEvent("panel:open", { detail: { id: panelId } }));
  }

  function setup() {
    $("toggleSidebar")?.addEventListener("click", () => $("sidebar")?.classList.toggle("open"));

    PANELES.forEach(({ panel, boton, cerrar }) => {
      $(boton)?.addEventListener("click", () => {
        if ($(panel)?.classList.contains("open")) cerrarPanel(panel);
        else abrirPanel(panel);
      });
      $(cerrar)?.addEventListener("click", () => cerrarPanel(panel));
    });

    $("measurementBtn")?.addEventListener("click", (e) => {
      const activo = window.toggleMeasurement?.();
      if (typeof activo === "boolean") e.currentTarget.classList.toggle("active", activo);
    });

    $("btnLocate")?.addEventListener("click", () => window.ubicarme?.());

    document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarTodos(); });
  }

  window.UI = { abrirPanel, cerrarPanel, cerrarTodos };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();
