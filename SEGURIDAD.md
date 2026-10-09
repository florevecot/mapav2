# Seguridad del Mapa OOEE

El mapa se protege en capas. Si una falla, la siguiente sigue cuidando los datos.

| Capa | Qué hace | Dónde se configura |
|---|---|---|
| 1. Repositorio privado | Nadie fuera de ti ve el código ni los datos en GitHub | GitHub → Settings |
| 2. Cloudflare Access | Pide correo + código antes de mostrar cualquier cosa | Cloudflare Zero Trust |
| 3. Verificación en el servidor | Cada petición (páginas, datos, API) debe traer un pase de Access firmado; si no, se rechaza | `functions/_middleware.js` + variables |
| 4. Administradores | Solo los correos en `ADMIN_EMAILS` pueden publicar datos nuevos | Variable `ADMIN_EMAILS` |
| 5. Token limitado | El token de GitHub solo puede escribir en este repo, y la función solo deja escribir 3 archivos de datos | GitHub + `functions/api/actualizar.js` |
| 6. Datos mínimos | Las columnas de clientes (medidores, N° cliente, contactos, bitácora) no se publican por defecto | Página "Actualizar datos" |
| 7. Navegador | Política de contenido, sin incrustación en otros sitios, HTTPS obligatorio, sin buscadores | `_headers` |

## Configuración paso a paso

### A. Cuentas (5 min)
1. **Activa la verificación en dos pasos** en GitHub (Settings → Password and authentication) y en Cloudflare (My Profile → Authentication). Es la medida más importante: quien entre a tus cuentas controla todo.
2. GitHub → repo `mapa-ooee` → Settings → General → **Change visibility → Private**.
3. GitHub → Settings → Pages: si sigue publicado, **Unpublish site**.

### B. Cloudflare Access (si aún no lo hiciste)
Zero Trust → Access → Applications → **Add an application → Self-hosted**:
- Hostnames: `mapa-ooee.pages.dev` **y** `*.mapa-ooee.pages.dev` (las vistas previas).
- Session duration: `24 hours`.
- Política **Allow** → *Emails* (lista de personas) o *Emails ending in* `@wom.cl`.
- Login method: **One-time PIN**.

Prueba en incógnito que `https://mapa-ooee.pages.dev/assets/mapa_inventario.json` pida inicio de sesión.

### C. Verificación en el servidor (capa 3)
1. En Zero Trust → Access → Applications → *Mapa OOEE* → **Overview**: copia el **Application Audience (AUD) Tag**.
2. En Zero Trust → Settings → Custom Pages (o en la URL de inicio de sesión) mira tu **team domain**, ej. `ooee-wom.cloudflareaccess.com`.
3. Cloudflare → Workers & Pages → `mapa-ooee` → **Settings → Variables and Secrets** → *Production*, agrega:
   - `ACCESS_TEAM_DOMAIN` = `ooee-wom` (tu team name)
   - `ACCESS_AUD` = el tag copiado
4. **Deployments → ⋯ → Retry deployment** del último despliegue (las variables se aplican al desplegar).
5. Abre el mapa normalmente: debe funcionar. Si ves "🔒 Acceso restringido", revisa que los valores estén bien escritos.

### D. Publicación de datos desde el mapa (capas 4 y 5)
1. **Token de GitHub** (solo para este repo):
   GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens → Generate new token**
   - Expiration: 90 días (pon un recordatorio para renovarlo)
   - Repository access: **Only select repositories** → `mapa-ooee`
   - Permissions → Repository → **Contents: Read and write** (nada más)
   - Copia el token (empieza con `github_pat_`). No lo guardes en ningún archivo ni lo envíes por chat.
2. En Cloudflare → `mapa-ooee` → Settings → Variables and Secrets → Production:
   - `GITHUB_TOKEN` → tipo **Secret** → pega el token
   - `GITHUB_REPO` = `florevecot/mapa-ooee`
   - `ADMIN_EMAILS` = correos que pueden actualizar, separados por coma
3. Retry deployment. Los administradores verán el botón **🔄 Actualizar datos** en la barra lateral.

> La publicación directa requiere la capa 3 activa: sin la firma verificada nadie es administrador.

## Rutina recomendada
- **Al salir alguien del equipo:** quítalo de la política de Access (y de `ADMIN_EMAILS` si estaba).
- **Cada 90 días:** renueva el token de GitHub y reemplaza `GITHUB_TOKEN`.
- **Cada mes:** revisa Zero Trust → Logs → Access para ver quién entró.
- **Si crees que el token se filtró:** bórralo en GitHub (deja de funcionar al instante) y crea otro.

## Antecedente
Mientras el repositorio fue público, el inventario completo (incluidos medidores, N° de cliente y contactos) pudo ser descargado. Pasarlo a privado protege desde ahora, pero no borra copias que alguien haya hecho. Conviene informarlo a tu área. Para que esas columnas no sigan en el historial de GitHub, la opción más simple es crear un repositorio nuevo con la versión actual y borrar el antiguo.

## Límites conocidos
- Las librerías del mapa (Leaflet, Sigma, Turf, SheetJS) se cargan desde CDNs públicos con versión fija. La política de contenido solo permite esos dominios.
- El plan gratuito de Cloudflare permite 100.000 peticiones diarias a funciones; cada carga del mapa usa ~20. Para un equipo es más que suficiente.
- Access gratis cubre hasta 50 usuarios.
