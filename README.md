# Canavida — publicar en Cloudflare (paso a paso)

Tiempo: unos 30 minutos. Todo desde el navegador.

Contenido de esta carpeta:
- `public/` → la app (index.html + fotos)
- `worker.js` → el "cerebro": busca la reserva en Lodgify y responde el chat con IA
- `wrangler.toml` → la configuración que Cloudflare lee
- `schema.sql` → las tablas de la memoria del asistente

---

## Paso 1 — Subir la carpeta a GitHub
1. Descomprima el .zip en su computadora.
2. Entre a **github.com/charliebrowncr/Brain**.
3. Clic en **"uploading an existing file"** (o *Add file → Upload files*).
4. Abra la carpeta descomprimida, seleccione **todo su contenido** (`public`, `worker.js`, `wrangler.toml`, `schema.sql`, `README.md`) y arrástrelo a la página.
   - Importante: `wrangler.toml` debe quedar en la **raíz** del repositorio, no dentro de otra carpeta.
5. Abajo, clic en **Commit changes**.

## Paso 2 — Crear la cuenta y la base de datos en Cloudflare
1. Entre a **dash.cloudflare.com** y cree su cuenta (gratis).
2. Menú izquierdo: **Storage & Databases → D1 SQL Database → Create database**.
3. Nombre: `canavida` → **Create**.
4. En la página de la base verá **Database ID** (un código largo). Cópielo.
5. Vaya a la pestaña **Console**, pegue todo el contenido de `schema.sql` y pulse **Execute**.

## Paso 3 — Pegar el ID de la base en GitHub
1. En GitHub abra `wrangler.toml` → icono del lápiz (Edit).
2. Reemplace `PEGUE-AQUI-EL-ID-DE-SU-D1` por el Database ID.
3. **Commit changes**.

## Paso 4 — Conectar GitHub con Cloudflare
1. Cloudflare → **Workers & Pages → Create → Import a repository**.
2. **Connect GitHub** → autorice → elija el repositorio `Brain`.
3. Configuración:
   - Project name: `canavida-app`
   - Build command: *(vacío)*
   - Deploy command: `npx wrangler deploy`
   - Root directory: *(vacío)*
4. **Deploy**. En 1–2 minutos le dará una dirección como `https://canavida-app.SU-USUARIO.workers.dev`. Ábrala: ya verá la app.

## Paso 5 — Conectar Lodgify
1. Lodgify → **Settings → Public API** → copie su **API Key**.
2. Cloudflare → Workers & Pages → `canavida-app` → **Settings → Variables and Secrets → Add**.
   - Type: **Secret**
   - Name: `LODGIFY_API_KEY`
   - Value: la clave de Lodgify
3. **Deploy** / Save.
4. Pruebe: abra `https://canavida-app.SU-USUARIO.workers.dev/api/reserva?nombre=Ana&apellidos=Rojas` con el nombre de un huésped real con reserva futura.
   - Si ve sus datos → funciona. Pruebe ahora en la app.
   - `{"notFound":true}` → la clave funciona pero el nombre no coincide (revise cómo está escrito en Lodgify).
   - `{"error":"lodgify"}` → la clave está mal o no se guardó.

## Paso 6 — La IA
No requiere nada más: el bloque `[ai]` de `wrangler.toml` activa Workers AI. Pruebe el chat en la app. Ya no dirá "Modo demo".

## Paso 7 — Enseñarle al asistente (cada semana, 5 minutos)
D1 → `canavida` → **Console**:

Ver qué preguntaron los huéspedes:
```
SELECT pregunta, respuesta FROM conversaciones ORDER BY id DESC LIMIT 50;
```
Agregar una respuesta correcta (el asistente la usa de inmediato):
```
INSERT INTO knowledge (pregunta, respuesta) VALUES ('Hora de check-in', 'A partir de las 3:00 p.m.');
```
Recomendado agregar desde el primer día: check-in, check-out, WhatsApp, wifi, supermercado más cercano.

## Paso 8 — Dominio propio (opcional)
Si su dominio ya está en Cloudflare: `canavida-app` → **Settings → Domains & Routes → Add → Custom domain** → `llegada.sudominio.com`.

## Para enviarla a los huéspedes
Comparta el enlace en el correo de confirmación de Lodgify. En el teléfono pueden usar "Agregar a pantalla de inicio" y queda como una app.

## Si algo falla
Cloudflare → `canavida-app` → **Logs** (o *Observability*) muestra el error exacto. Cópielo y envíemelo.
