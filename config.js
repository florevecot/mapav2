// ======================================================
// config.js – Configuración central del Mapa OOEE
// ======================================================

window.APP_CONFIG = {
  // Datos (se sirven junto al sitio)
  DATA_URL: "./assets/mapa_inventario.json",   // inventario de sitios (mapa)
  GRAPH_URL: "./assets/sigma_mapa.json",       // nodos + conexiones (grafo y dependencias)

  // Vista inicial del mapa
  CENTRO_INICIAL: [-33.45, -70.66],
  ZOOM_INICIAL: 5,

  // Mapas base gratuitos (sin clave). El primero es el que se carga por defecto.
  // Respeta los términos de uso de cada proveedor; para uso intensivo
  // conviene un proveedor con plan propio (MapTiler, Stadia, etc.).
  MAPAS_BASE: [
    {
      id: "osm",
      nombre: "OpenStreetMap",
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    },
    {
      id: "claro",
      nombre: "Claro (CARTO)",
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      subdomains: "abcd",
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    },
    {
      id: "oscuro",
      nombre: "Oscuro (CARTO)",
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      subdomains: "abcd",
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    },
    {
      id: "topo",
      nombre: "Topográfico",
      url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      subdomains: "abc",
      maxZoom: 17,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="https://opentopomap.org">OpenTopoMap</a>'
    },
    {
      // Teselas públicas de imágenes satelitales. No requiere cuenta ni genera cobros.
      // Si prefieres no usar nada de Esri, borra este bloque.
      id: "satelite",
      nombre: "Satélite",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      maxZoom: 19,
      attribution: "Imágenes &copy; Esri, Maxar, Earthstar Geographics"
    }
  ],

  // Búsqueda de direcciones y comuna (Nominatim / OpenStreetMap, gratis, máx. 1 consulta por segundo)
  NOMINATIM_URL: "https://nominatim.openstreetmap.org",

  // Proxy para consultar el SII. Corre como función de Cloudflare Pages
  // (functions/api/sii-proxy.js) en el mismo sitio. Vacío ("") = herramientas SII desactivadas.
  SII_PROXY_URL: "/api/sii-proxy",

  // Intermediario para servicios GIS externos (functions/api/gis-proxy.js)
  GIS_PROXY_URL: "/api/gis-proxy",

  // ====================================================
  // CAPAS EXTERNAS (servicios públicos ArcGIS REST, sin cuenta ni cobro)
  // ====================================================
  CAPAS_EXTERNAS: [
    {
      id: "sec",
      tipo: "mapserver",                 // se dibuja como imágenes y se consulta con clic
      nombre: "Redes eléctricas SEC",
      icono: "⚡",
      url: "https://apps.sec.cl/arcgis/rest/services/Layers/MapServer",
      visibleInicial: false,
      opacidad: 0.85,
      atribucion: "Redes eléctricas &copy; SEC"
    },
    {
      id: "antenas",
      tipo: "antenas",                   // sitios agrupados por ubicación y operadora
      nombre: "Antenas SUBTEL",
      icono: "📡",
      zoomMinimo: 10,                    // por debajo de este zoom no se descargan (serían demasiadas)
      // SUBTEL publica un servicio por operadora. Cada una es una capa que se
      // prende y apaga por separado (botones en la barra lateral y en "Capas").
      // visible: estado inicial la primera vez; después se recuerda lo que elijas.
      servicios: [
        { id: "entel",    operadora: "Entel",           icono: "🔵", color: "#0047bb", visible: false,
          url: "https://licancabur.subtel.gob.cl/server/rest/services/Estaciones_Base_Entel/FeatureServer/0" },
        { id: "movistar", operadora: "Movistar / Tigo", icono: "🟢", color: "#5bc500", visible: false,
          url: "https://licancabur.subtel.gob.cl/server/rest/services/Estaciones_Base_Movistar/FeatureServer/0" },
        { id: "claro",    operadora: "Claro",           icono: "🔴", color: "#da291c", visible: false,
          url: "https://licancabur.subtel.gob.cl/server/rest/services/Estaciones_Base_Claro/FeatureServer/0" },
        // Antenas WOM según SUBTEL (para comparar con el inventario propio). Borra estas dos líneas si no la necesitas.
        { id: "wom",      operadora: "WOM",             icono: "🟣", color: "#7212e8", visible: false,
          url: "https://licancabur.subtel.gob.cl/server/rest/services/Estaciones_Base_Wom/FeatureServer/0" }
      ],
      filtro: "1=1",                     // ej.: "tite_cod IN ('4G','5G')"
      // Campos: se buscan por nombre o por alias (el nombre visible en el visor de SUBTEL)
      campos: {
        tecnologia: ["tite_cod", "TECNOLOGIA"],
        estacion: ["ESTACION"],
        direccion: ["DIRECCION"],
        comuna: ["COMUNA"],
        region: ["REGION"],
        periodo: ["PERIODO"],
        latitud: ["LATITUD"],
        longitud: ["LONGITUD"],
        empresa: ["EMPRESA"]
      },
      atribucion: "Antenas &copy; SUBTEL"
    }
  ]
};

// Descarga compartida de JSON: el mapa y el grafo usan el mismo archivo
// de conexiones y así se descarga una sola vez.
(function () {
  const cache = new Map();
  window.cargarJSON = function (url) {
    if (!cache.has(url)) {
      cache.set(url, fetch(url).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} al descargar ${url}`);
        return r.json();
      }).catch((err) => { cache.delete(url); throw err; }));
    }
    return cache.get(url);
  };
})();
