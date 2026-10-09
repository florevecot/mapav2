# Mapa OOEE

Mapa interactivo de sitios WOM con estado de obras eléctricas (OOEE), dependencias entre sitios y consulta de predios SII.

- **Código y datos:** repositorio privado en GitHub (`florevecot/mapa-ooee`).
- **Publicación:** Cloudflare Pages, que lee el repo y republica automáticamente con cada cambio.
- **Seguridad:** Cloudflare Access, que exige inicio de sesión por correo antes de ver cualquier cosa. Gratis hasta 50 usuarios.
- **Mapa:** Leaflet + OpenStreetMap, sin cuentas ni cobros.

## 1. Repositorio privado en GitHub

1. En el repo: **Settings → General → Danger Zone → Change repository visibility → Private**.
2. **Settings → Pages**: si aparece publicado, presiona **Unpublish site**. Desde ahora el sitio vive en Cloudflare.
3. Sube los archivos de esta versión: **Add file → Upload files**, arrastra todo el contenido y confirma. Los archivos con el mismo nombre se reemplazan.
4. Borra lo que ya no se usa. Abre cada archivo, menú **⋯ → Delete file** y confirma:
   - `netlify/functions/sii-proxy.js`
   - `package.json`

## 2. Publicar con Cloudflare Pages

1. Crea una cuenta gratis en <https://dash.cloudflare.com/sign-up>.
2. En el menú: **Workers & Pages → Create**. Elige la pestaña **Pages** y luego **Import an existing Git repository**.
3. Conecta tu cuenta de GitHub. Cuando GitHub pregunte, da acceso **solo** al repositorio `mapa-ooee`.
4. Selecciona `mapa-ooee` y configura:
   - **Project name:** `mapa-ooee`. Define la URL `https://mapa-ooee.pages.dev`; si el nombre está ocupado, usa otro.
   - **Framework preset:** `None`
   - **Build command:** déjalo vacío
   - **Build output directory:** `/`
5. Presiona **Save and Deploy**. En 1–2 minutos queda publicado.

> **No compartas la URL todavía.** Configura el paso 3 inmediatamente: hasta entonces el sitio es público.

## 3. Proteger con Cloudflare Access (inicio de sesión)

1. En el dashboard de Cloudflare, abre **Zero Trust**.
   - La primera vez pide un *team name* (por ejemplo `ooee-wom`) y elegir plan: selecciona **Free**. Es posible que solicite una tarjeta de pago aunque el plan sea gratis.
2. Ve a **Access → Applications → Add an application → Self-hosted**.
3. Configura la aplicación:
   - **Application name:** `Mapa OOEE`
   - **Session duration:** `24 hours` (cada cuánto se vuelve a pedir el código)
   - **Public hostname:** agrega dos:
     - `mapa-ooee.pages.dev`
     - `*.mapa-ooee.pages.dev` (protege también las versiones de prueba que Cloudflare crea en cada cambio)
4. Crea una **política**:
   - **Policy name:** `Equipo OOEE`
   - **Action:** `Allow`
   - **Include:** elige **Emails ending in** y escribe `@wom.cl` (todo el dominio), o **Emails** y escribe los correos uno por uno.
5. En **Login methods** deja **One-time PIN**: cada persona escribe su correo y recibe un código.
6. Guarda.

**Verificación:** abre `https://mapa-ooee.pages.dev` en una ventana de incógnito. Debe aparecer la pantalla de Cloudflare pidiendo un correo. Prueba también `https://mapa-ooee.pages.dev/assets/mapa_inventario.json`: debe pedir inicio de sesión, no descargar el archivo.

Para dar o quitar acceso a alguien: **Zero Trust → Access → Applications → Mapa OOEE → Policies**.

## Actualizar la base de datos

Los datos viven en GitHub (`assets/`) y Cloudflare publica cada cambio en 1–2 minutos. Hay dos formas de actualizarlos; ambas usan la página **Actualizar datos** (`/actualizar.html`), que valida el archivo antes de publicar.

### Paso a paso
1. Exporta tu planilla a **Excel** (o CSV). Debe tener una fila de encabezados con al menos `Nemonico`, `Lat`, `Long` y `Estado OOEE` (también se aceptan `Nemónico`, `Latitud`, `Longitud`). Las demás columnas aparecen solas en el popup del mapa.
2. Abre el mapa → **🔄 Actualizar datos** (solo administradores) o entra a `https://mapa-ooee.pages.dev/actualizar.html`.
3. Sube el archivo. Si tiene varias hojas, elige cuál es el inventario y, si existe, cuál tiene las conexiones (columnas `from`/`to` u `Origen`/`Destino`).
4. Revisa:
   - **Columnas a publicar:** las de clientes y contactos vienen desmarcadas (🔒). Tu elección se recuerda.
   - **Conexiones:** mantener las actuales, agregar las de la columna “Torre Padre”, reconstruirlas desde esa columna o usar la hoja de conexiones.
   - **Revisión:** sitios nuevos, que salen y con cambios; avisos de nemónicos repetidos, sin coordenadas o fuera de Chile. Si el archivo trae 20 % menos sitios que lo publicado, pide confirmación (evita subir un archivo incompleto por error).
5. **🚀 Publicar en el mapa**: guarda una nueva versión en GitHub con tu correo y la descripción. En 1–2 minutos el mapa muestra los datos nuevos y abajo a la izquierda aparece “Datos al …”.
   - Sin publicación directa configurada: **⬇️ Descargar archivos** y súbelos en GitHub → carpeta `assets` → *Add file → Upload files* → *Commit changes*.

### Volver a una versión anterior
Cada publicación queda en el historial de GitHub. En el repo → **Commits** → abre el commit anterior → **⋯ → Revert** (o pídele a alguien con Git `git revert <commit>`). Cloudflare vuelve a publicar solo.

### Archivos de datos
- `assets/mapa_inventario.json`: arreglo de sitios (máx. 25 MB).
- `assets/sigma_mapa.json`: `{ "nodes": [...], "edges": [{ "from", "to" }] }` para el grafo y los saltos.
- `assets/datos_meta.json`: fecha, autor, cantidad de sitios y columnas publicadas.

## Capas externas (SEC y SUBTEL)

Se configuran en `js/config.js` → `CAPAS_EXTERNAS`. Cada capa se prende y apaga por separado de dos formas: con su **botón en la barra lateral** (sección "Capas externas") o con su casilla en el panel **Capas**. Ambos quedan sincronizados y el mapa **recuerda** qué dejaste prendido para la próxima visita.

Capas disponibles: ⚡ Redes eléctricas SEC, 🔵 Entel, 🟢 Movistar / Tigo, 🔴 Claro y 🟣 WOM (según SUBTEL). Solo se descargan las operadoras que estén prendidas. Son servicios públicos del Estado (ArcGIS REST): no requieren cuenta ni generan cobros.

- **⚡ Redes eléctricas SEC** (`tipo: "mapserver"`): el mapa lee la lista de capas del servicio y permite activarlas una por una, con su leyenda y opacidad. Con un clic sobre una línea se ven sus datos.
- **📡 Antenas SUBTEL** (`tipo: "antenas"`): consulta los cuatro servicios de SUBTEL (`Estaciones_Base_Entel`, `_Movistar`, `_Claro`, `_Wom`) y muestra los sitios por operadora. Si una operadora tiene varias tecnologías en el mismo punto se juntan en un solo sitio (ej. CLARO: 4G · 5G); si hay varias operadoras en el mismo punto se dibujan anillos concéntricos de colores. Filtros por operadora y por tecnología (campo `tite_cod`). Se cargan al acercar el mapa (zoom 10 o más) para no descargar todo Chile.

Los campos se encuentran por nombre o por el alias que muestra el visor de SUBTEL (TECNOLOGIA, ESTACION, DIRECCION, COMUNA, PERIODO…), así que si SUBTEL cambia nombres internos normalmente no hay que tocar nada. Para agregar otra operadora, suma una línea en `servicios`. Para ver solo algunas tecnologías desde el servidor: `filtro: "tite_cod IN ('4G','5G')"`.

Si algún servicio queda en un servidor distinto de `licancabur.subtel.gob.cl`, `apps.sec.cl` o `servicesN.arcgis.com`, agrégalo en Cloudflare (**Workers & Pages → mapa-ooee → Settings → Variables**, variable `GIS_HOSTS`) y en `img-src` de `_headers`.

## Seguridad

Ver **[SEGURIDAD.md](SEGURIDAD.md)**: capas de protección, cómo activarlas en Cloudflare (variables `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ADMIN_EMAILS`, `GITHUB_TOKEN`, `GITHUB_REPO`) y rutina de mantenimiento.

## Probar en local

```bash
python -m http.server 8000
# abrir http://localhost:8000
```

En local las cabeceras de `_headers` no se aplican y el proxy SII no está disponible. Para probar todo, usa `npx wrangler pages dev .`, que requiere Node.js.

## Estructura

```
index.html                 página principal
actualizar.html            página para actualizar la base de datos
SEGURIDAD.md               guía de seguridad
lib/admin.js               utilidades compartidas de las funciones
_headers                   cabeceras de seguridad (Cloudflare)
robots.txt                 bloqueo de buscadores
functions/_middleware.js   verificación de la sesión de Access en cada petición
functions/api/yo.js        quién soy / soy administrador
functions/api/actualizar.js publica datos nuevos en GitHub (solo admins)
functions/api/sii-proxy.js proxy SII (Cloudflare Pages Function)
functions/api/gis-proxy.js proxy para capas externas SEC / SUBTEL
css/style.css              estilos
js/actualizar.js           lógica de la página de actualización
js/config.js               configuración (mapas base, rutas de datos, proxy)
js/app.map.js              mapa: sitios, filtros, búsqueda, medición, dependencias, SII
js/capas.externas.js       capas SEC (redes eléctricas) y SUBTEL (antenas)
js/sigma.js                grafo (Sigma.js + Graphology)
js/graph.controller.js     selección de nodos y saltos
js/ui.sidebar.js           barra lateral y paneles
js/ui.sidebar.graph.js     buscador e info del grafo
js/modeController.js       cambio Mapa ⇄ Grafo
assets/                    logo y datos
```
