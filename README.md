# TAY’S STUDIO — Telegram Auto-Progress Launch Bot

Servicio **independiente** (no toca el backend de pagos/PayPal). Publica una imagen AMOLED con barra de progreso en tu canal, calcula el progreso solo y lo actualiza en la misma publicación.

## Cómo funciona
- **Progreso automático**: lineal desde `LAUNCH_PROGRESS` (85 %) en `PROGRESS_START_AT` hasta 100 % en `LAUNCH_AT`. Se redondea hacia abajo, así que el 100 % solo aparece a la hora del lanzamiento. Antes del inicio muestra el 85 %.
- **Cuenta regresiva**: el texto se edita cada 60 s (`editMessageCaption`, sin re-subir imagen).
- **Imagen**: se regenera y se edita (`editMessageMedia`) solo cuando cambia el % entero (o una vez al arrancar).
- **Sin duplicados al reiniciar**: busca la publicación en este orden: `LAUNCH_MESSAGE_ID` → `STATE_FILE` → mensaje fijado del canal (si es del bot). Solo publica si no encuentra ninguna.
- **Fallos**: si falla la imagen, intenta actualizar el texto; los errores de red/429 se reintentan y nunca detienen el proceso.
- **Lanzamiento**: si `FINAL_ANNOUNCEMENT_ENABLED=true`, publica el anuncio final, fija el anuncio y elimina la publicación de progreso. Si es `false`, la barra se queda en 100 % y no se anuncia nada.
- **Fuentes**: el texto de la imagen se convierte a vectores con las fuentes incluidas en `fonts/` (Space Grotesk, licencia OFL), así que no hay cuadrados ni glifos ausentes en Railway.

## Dependencias
- `sharp` (SVG→PNG, trae binarios precompilados para Linux; funciona en Railway)
- `opentype.js` 1.3.4 (texto → trazados)
- Node.js ≥ 20 (usa `fetch`, `FormData` y `Blob` nativos)

## Variables para Railway (Raw Editor)
```
TELEGRAM_BOT_TOKEN=PEGA_AQUI_EL_TOKEN_DE_BOTFATHER
TELEGRAM_CHANNEL=@pruebastgs
PROGRESS_START_AT=2026-10-28T20:00:00-06:00
LAUNCH_AT=2026-10-31T20:00:00-06:00
LAUNCH_PROGRESS=85
FINAL_ANNOUNCEMENT_ENABLED=false
```
Opcionales: `LAUNCH_MESSAGE_ID`, `FINAL_LINK_URL`, `FINAL_LINK_TEXT`, `PIN_PROGRESS_POST` (true), `TIMEZONE` (America/Costa_Rica), `STATE_FILE`.

**Recomendado:** crea un *Volume* en Railway montado en `/data` y pon `STATE_FILE=/data/state.json`. Sin volumen funciona igual gracias al mensaje fijado, pero el volumen es la protección más segura contra duplicados.

## Reemplazar la imagen defectuosa sin perder nada
1. En los logs del bot anterior (o desde Telegram: clic derecho/mantener → *Copiar enlace*, el número final es el ID) busca el ID de la publicación vieja.
2. Pon ese número en `LAUNCH_MESSAGE_ID`. El bot nuevo **edita esa misma publicación** con la imagen corregida; el canal y el resto de publicaciones no se tocan.
3. Alternativa: borra manualmente la publicación vieja, deja `LAUNCH_MESSAGE_ID` vacío y el bot creará una nueva.

## Desplegar
1. Sube estos archivos a tu repo del bot (no al de pagos). `node_modules`, `.env` y `state.json` están en `.gitignore`. **Nunca subas el token.**
2. En BotFather revisa que el bot sea administrador del canal con permisos de publicar, editar, eliminar y fijar mensajes.
3. Carga las variables en Railway y despliega. Start command: `npm start`.
4. Revisa los logs: deben aparecer `Bot: @...`, `Publicación creada. message_id=...` y luego `Imagen y texto actualizados`.
5. Prueba en `@pruebastgs`. Para probar el final, pon temporalmente `LAUNCH_AT` en unos minutos y `FINAL_ANNOUNCEMENT_ENABLED=true`.
6. Para producción, cambia `TELEGRAM_CHANNEL` al canal público (el estado guardado de otro canal se ignora).

## Retrasar el lanzamiento
Cambia `LAUNCH_AT` en Railway (el progreso se recalcula solo). Si ya habías anunciado, borra el anuncio fijado o el `state.json`.

## Vista previa local de la imagen
`npm install && npm run preview -- 93` genera `preview-93.png`.

## Problemas frecuentes
- `chat not found`: revisa `TELEGRAM_CHANNEL` y que el bot sea admin.
- `not enough rights`: falta permiso de editar/eliminar/fijar.
- `message to edit not found`: el ID no existe; el bot crea una nueva publicación.
- Token expuesto: revócalo en BotFather y cambia la variable.
