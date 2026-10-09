// ======================================================
// graph.controller.js – Selección de nodo + subgrafos por saltos (BFS)
// ======================================================

(function () {
  window.APP_STATE = window.APP_STATE || { showingSubgraph: false, selectedNode: null };

  const controller = {};
  const state = { ready: false, selected: null, visible: null, depth: 1 };
  const adjacency = new Map();

  const ensure = () => !!(window.sigmaGraph && window.sigmaInstance);

  function buildAdjacency() {
    adjacency.clear();
    const g = window.sigmaGraph;
    g.forEachNode((id) => adjacency.set(id, new Set()));
    // Dependencia se trata como no dirigida para "saltos" (padre e hijos)
    g.forEachEdge((_, __, s, t) => {
      adjacency.get(s)?.add(t);
      adjacency.get(t)?.add(s);
    });
  }

  function bfs(root, depth) {
    const vis = new Set([root]);
    let frontier = [root];
    for (let d = 0; d < depth && frontier.length; d++) {
      const next = [];
      for (const u of frontier) {
        for (const v of adjacency.get(u) || []) {
          if (!vis.has(v)) { vis.add(v); next.push(v); }
        }
      }
      frontier = next;
    }
    return vis;
  }

  function restaurarEstilos() {
    const g = window.sigmaGraph;
    g.forEachNode((id, a) => {
      g.mergeNodeAttributes(id, { hidden: false, highlighted: false, size: a.baseSize, color: a.baseColor, zIndex: 0 });
    });
    g.forEachEdge((e) => g.setEdgeAttribute(e, "hidden", false));
  }

  function applyVisibility(nodesSet, root) {
    const g = window.sigmaGraph;
    g.forEachNode((id, a) => {
      const visible = nodesSet.has(id);
      g.mergeNodeAttributes(id, {
        hidden: !visible,
        highlighted: id === root,
        size: id === root ? a.baseSize * 3 : visible ? a.baseSize * 1.6 : a.baseSize,
        zIndex: id === root ? 2 : 1
      });
    });
    g.forEachEdge((edge, _, s, t) => {
      g.setEdgeAttribute(edge, "hidden", !(nodesSet.has(s) && nodesSet.has(t)));
    });
    window.sigmaInstance.refresh();
  }

  function showAll() {
    if (!ensure()) return;
    restaurarEstilos();
    window.sigmaInstance.refresh();
    window.sigmaResetView?.();

    state.selected = null;
    state.visible = null;
    state.depth = 1;
    window.APP_STATE.showingSubgraph = false;
    window.APP_STATE.selectedNode = null;
    window.dispatchEvent(new Event("graph:cleared"));
  }

  function countVisibleEdges(nodesSet) {
    let c = 0;
    window.sigmaGraph.forEachEdge((_, __, s, t) => { if (nodesSet.has(s) && nodesSet.has(t)) c++; });
    return c;
  }

  function showNeighborhood(root, depth) {
    if (!ensure()) return;
    state.depth = depth;
    state.selected = root;
    state.visible = bfs(root, depth);
    window.APP_STATE.showingSubgraph = true;
    window.APP_STATE.selectedNode = root;

    applyVisibility(state.visible, root);
    window.sigmaFitNodes?.(state.visible);

    const attrs = window.sigmaGraph.getNodeAttributes(root);
    const neighbors = Array.from(adjacency.get(root) || []);
    window.dispatchEvent(new CustomEvent("graph:subgraph", {
      detail: {
        root,
        depth,
        nodes: state.visible.size,
        edges: countVisibleEdges(state.visible),
        energia: attrs?.energia ?? null,
        nombre: attrs?.raw?.["Nombre Sitio"] ?? "",
        comuna: attrs?.raw?.["Comuna"] ?? "",
        neighbors
      }
    }));
  }

  // ---------------- API pública ----------------
  controller.selectNode = function (id) {
    if (!ensure() || !window.sigmaGraph.hasNode(id)) return false;
    showNeighborhood(id, 1);
    window.dispatchEvent(new CustomEvent("graph:selected", { detail: { id, depth: 1 } }));
    return true;
  };

  controller.showDeps = function (depth) {
    if (state.selected) showNeighborhood(state.selected, depth);
  };

  controller.resetView = showAll;

  controller.searchIds = function (q, limit = 25) {
    if (!ensure()) return [];
    const Q = (q || "").trim().toUpperCase();
    if (!Q) return [];
    const exact = [];
    const starts = [];
    const contains = [];
    window.sigmaGraph.forEachNode((id) => {
      const U = id.toUpperCase();
      if (U === Q) exact.push(id);
      else if (U.startsWith(Q)) starts.push(id);
      else if (U.includes(Q)) contains.push(id);
    });
    return [...exact, ...starts.sort(), ...contains.sort()].slice(0, limit);
  };

  controller.isReady = () => state.ready;
  controller.getSelected = () => state.selected;

  controller.onGraphReady = function () {
    if (!ensure()) return;
    buildAdjacency();
    state.ready = true;
    state.selected = null;
    state.visible = null;

    window.sigmaInstance.on("clickNode", (e) => controller.selectNode(e.node));
    window.sigmaInstance.on("enterNode", () => { document.getElementById("graphDiv").style.cursor = "pointer"; });
    window.sigmaInstance.on("leaveNode", () => { document.getElementById("graphDiv").style.cursor = "default"; });

    window.dispatchEvent(new Event("graph:ready"));
  };

  window.graphController = controller;
})();
