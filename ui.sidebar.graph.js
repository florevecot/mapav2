// ======================================================
// ui.sidebar.graph.js – Buscador del grafo + botones de saltos + panel info
// ======================================================

(function () {
  const $ = (id) => document.getElementById(id);
  const show = (el) => el && el.classList.remove("hidden");
  const hide = (el) => el && el.classList.add("hidden");

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  function energiaToText(v) {
    if (v === null || v === undefined || String(v).trim() === "") return "Sin dato";
    if (typeof v === "boolean") return v ? "OK" : "NO";
    if (typeof v === "number") return v === 1 ? "OK" : "NO";
    return String(v);
  }

  function wire() {
    const input = $("graphSearchInput");
    const list = $("graphSearchResults");
    const b1 = $("btnDeps1"), b2 = $("btnDeps2"), b3 = $("btnDeps3");
    const bReset = $("btnResetGraph");
    const info = $("graphInfoPanel");
    if (!input || !list || !bReset) return;

    hide(list); hide(b1); hide(b2); hide(b3);
    input.disabled = true;
    input.placeholder = "Cargando grafo...";

    function marcarProfundidad(depth) {
      [b1, b2, b3].forEach((b, i) => b?.classList.toggle("active", i + 1 === depth));
    }

    function renderResults(items) {
      list.innerHTML = "";
      if (!items.length) { hide(list); return; }
      items.forEach((id) => {
        const li = document.createElement("li");
        li.textContent = id;
        li.className = "graph-search-item";
        li.addEventListener("click", () => {
          window.graphController?.selectNode?.(id);
          input.value = id;
          list.innerHTML = "";
          hide(list);
        });
        list.appendChild(li);
      });
      show(list);
    }

    window.addEventListener("graph:ready", () => {
      input.disabled = false;
      input.placeholder = "Buscar sitio...";
    });

    input.addEventListener("input", () => {
      if (!window.graphController?.isReady?.()) return;
      renderResults(window.graphController.searchIds(input.value, 25));
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") list.querySelector("li")?.click();
      if (e.key === "Escape") { list.innerHTML = ""; hide(list); }
    });

    b1 && (b1.onclick = () => window.graphController?.showDeps?.(1));
    b2 && (b2.onclick = () => window.graphController?.showDeps?.(2));
    b3 && (b3.onclick = () => window.graphController?.showDeps?.(3));

    bReset.onclick = () => {
      window.graphController?.resetView?.();
      input.value = "";
      list.innerHTML = "";
      hide(list);
    };

    window.addEventListener("graph:selected", () => { show(b1); show(b2); show(b3); });

    window.addEventListener("graph:subgraph", (e) => {
      const d = e.detail || {};
      marcarProfundidad(d.depth);
      if (!info) return;
      const neighbors = Array.isArray(d.neighbors) ? d.neighbors : [];
      const preview = neighbors.slice(0, 8).map(esc).join(", ");
      info.innerHTML = `
        <strong>📡 ${esc(d.root)}</strong>
        ${d.nombre ? `<div class="muted">${esc(d.nombre)}${d.comuna ? " · " + esc(d.comuna) : ""}</div>` : ""}
        <div class="info-row">⚡ Energía: <strong>${esc(energiaToText(d.energia))}</strong></div>
        <div class="info-row">🌐 Saltos: <strong>${d.depth}</strong></div>
        <div class="info-row">🔗 Nodos visibles: <strong>${d.nodes}</strong></div>
        <div class="info-row">➖ Aristas visibles: <strong>${d.edges}</strong></div>
        <div class="info-row">👥 Vecinos directos: <strong>${neighbors.length}</strong>
          ${preview ? `<div class="muted">${preview}${neighbors.length > 8 ? "…" : ""}</div>` : ""}
        </div>`;
    });

    window.addEventListener("graph:cleared", () => {
      hide(b1); hide(b2); hide(b3);
      marcarProfundidad(0);
      if (info) info.innerHTML = `<p class="muted">Selecciona un nodo…</p>`;
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
