"use strict";
/**
 * TAY’S STUDIO — Telegram Auto-Progress Launch Bot
 *
 * Servicio independiente (no toca el backend de pagos / PayPal).
 * - Publica UNA sola publicación con imagen AMOLED + barra de progreso.
 * - Calcula el progreso automáticamente entre PROGRESS_START_AT y LAUNCH_AT.
 * - Cuenta regresiva en el texto (caption) cada 60 s.
 * - Regenera la imagen solo cuando cambia el porcentaje entero.
 * - Se recupera tras reinicios sin duplicar publicaciones.
 * - Anuncio final opcional (FINAL_ANNOUNCEMENT_ENABLED=true).
 */
const fs = require("node:fs");
const path = require("node:path");
const { renderPng } = require("./render");

/* ------------------------------------------------------------------ */
/* Configuración (todo por variables de entorno)                       */
/* ------------------------------------------------------------------ */
const env = (k, d = "") => (process.env[k] ?? "").trim() || d;
const bool = (v) => ["1", "true", "yes", "on", "si", "sí"].includes(String(v).toLowerCase());

const TOKEN = env("TELEGRAM_BOT_TOKEN");
const CHANNEL = env("TELEGRAM_CHANNEL", "@pruebastgs");
const PROGRESS_START_AT = env("PROGRESS_START_AT", "2026-10-28T20:00:00-06:00");
const LAUNCH_AT = env("LAUNCH_AT", "2026-10-31T20:00:00-06:00");
const START_PROGRESS = Number(env("LAUNCH_PROGRESS", "85"));
const ENV_MESSAGE_ID = env("LAUNCH_MESSAGE_ID");
const FINAL_ENABLED = bool(env("FINAL_ANNOUNCEMENT_ENABLED", "false"));
const FINAL_LINK_URL = env("FINAL_LINK_URL");
const FINAL_LINK_TEXT = env("FINAL_LINK_TEXT", "Open TAY’S STUDIO");
const PIN_POST = bool(env("PIN_PROGRESS_POST", "true"));
const TIMEZONE = env("TIMEZONE", "America/Costa_Rica");
const STATE_FILE = env("STATE_FILE", path.join(__dirname, "state.json"));
const TICK_MS = Number(env("TICK_MS", "60000")); // solo cambiar para pruebas locales
const API_BASE = env("TELEGRAM_API_BASE", "https://api.telegram.org"); // solo para pruebas locales

const startMs = Date.parse(PROGRESS_START_AT);
const launchMs = Date.parse(LAUNCH_AT);

function fatal(msg) {
  console.error(`[config] ${msg}`);
  process.exit(1);
}
if (!TOKEN) fatal("Falta TELEGRAM_BOT_TOKEN.");
if (!Number.isFinite(startMs)) fatal("PROGRESS_START_AT no es una fecha ISO-8601 válida.");
if (!Number.isFinite(launchMs)) fatal("LAUNCH_AT no es una fecha ISO-8601 válida.");
if (launchMs <= startMs) fatal("LAUNCH_AT debe ser posterior a PROGRESS_START_AT.");
if (!Number.isFinite(START_PROGRESS) || START_PROGRESS < 0 || START_PROGRESS > 100) {
  fatal("LAUNCH_PROGRESS debe ser un número entre 0 y 100.");
}
if (ENV_MESSAGE_ID && !/^\d+$/.test(ENV_MESSAGE_ID)) fatal("LAUNCH_MESSAGE_ID debe ser un número entero.");
if (FINAL_LINK_URL && !/^https?:\/\//i.test(FINAL_LINK_URL)) fatal("FINAL_LINK_URL debe empezar por http:// o https://");

const API = `${API_BASE}/bot${TOKEN}`;

// Marcadores para reconocer nuestras publicaciones (p. ej. en el mensaje fijado).
const PROGRESS_MARKER = "LAUNCH PROGRESS";
const FINAL_MARKER = "NOW LIVE";

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */
const log = (...a) => console.log(new Date().toISOString(), ...a);
const warn = (...a) => console.warn(new Date().toISOString(), "WARN", ...a);
const errlog = (...a) => console.error(new Date().toISOString(), "ERROR", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TelegramError extends Error {
  constructor(method, data, status) {
    super(`${method}: ${data?.description || `HTTP ${status}`}`);
    this.method = method;
    this.code = data?.error_code ?? status;
    this.description = data?.description || "";
    this.retryAfter = data?.parameters?.retry_after;
  }
}

/**
 * Llama a la API de Telegram Bot.
 * - fields: parámetros (objetos se serializan a JSON).
 * - file: Buffer PNG opcional, se adjunta como "photo" (para sendPhoto / attach://photo).
 * - retry: reintenta ante errores de red / 5xx. Se desactiva en envíos para no duplicar.
 */
async function tg(method, fields = {}, { file = null, retry = true } = {}) {
  const maxAttempts = retry ? 3 : 1;
  for (let attempt = 1; ; attempt++) {
    try {
      let init;
      if (file) {
        const form = new FormData();
        for (const [k, v] of Object.entries(fields)) {
          form.append(k, typeof v === "string" ? v : JSON.stringify(v));
        }
        form.append("photo", new Blob([file], { type: "image/png" }), "launch.png");
        init = { method: "POST", body: form };
      } else {
        init = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(fields),
        };
      }
      const res = await fetch(`${API}/${method}`, { ...init, signal: AbortSignal.timeout(30_000) });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* respuesta no JSON */
      }
      if (res.ok && data?.ok) return data.result;
      throw new TelegramError(method, data, res.status);
    } catch (e) {
      const isTg = e instanceof TelegramError;
      if (isTg && e.code === 429 && attempt < 4) {
        const wait = (e.retryAfter ?? 5) + 1;
        warn(`${method}: límite de la API (429). Esperando ${wait}s…`);
        await sleep(wait * 1000);
        continue;
      }
      const transient = !isTg || e.code >= 500;
      if (transient && attempt < maxAttempts) {
        warn(`${method}: error transitorio (${e.message}). Reintento ${attempt}/${maxAttempts - 1}…`);
        await sleep(2000 * attempt);
        continue;
      }
      throw e;
    }
  }
}

const isNotModified = (e) => e instanceof TelegramError && /message is not modified/i.test(e.description);
const isMessageGone = (e) =>
  e instanceof TelegramError && /message to edit not found|message can't be edited|MESSAGE_ID_INVALID|message to delete not found/i.test(e.description);

/* ------------------------------------------------------------------ */
/* Estado persistente (opcional) — ver README sobre Volumes            */
/* ------------------------------------------------------------------ */
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (s.channel !== CHANNEL) return {}; // otro canal (p. ej. de pruebas a público): estado no aplicable
    return s;
  } catch {
    return {};
  }
}
function saveState(patch) {
  try {
    const next = { ...loadState(), ...patch, channel: CHANNEL };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  } catch (e) {
    warn(`No se pudo guardar el estado en ${STATE_FILE}: ${e.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Lógica de progreso y textos                                         */
/* ------------------------------------------------------------------ */
function computeProgress(now = Date.now()) {
  if (now >= launchMs) return 100;
  if (now <= startMs) return Math.floor(START_PROGRESS);
  const ratio = (now - startMs) / (launchMs - startMs);
  const value = START_PROGRESS + (100 - START_PROGRESS) * ratio;
  // floor: el 100 % solo se alcanza al llegar la hora de lanzamiento.
  return Math.min(99, Math.max(Math.floor(START_PROGRESS), Math.floor(value)));
}

function launchLabel() {
  const d = new Date(launchMs);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "shortOffset",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  const tz = (parts.timeZoneName || "").replace("GMT", "UTC");
  return `${String(parts.month).toUpperCase()} ${parts.day} · ${parts.hour}:${parts.minute} ${parts.dayPeriod} (${tz})`;
}

function countdownLines(now = Date.now()) {
  const remaining = launchMs - now;
  if (remaining <= 0) return ["⏳ Launch time has arrived — final confirmation in progress."];
  const totalMin = Math.floor(remaining / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;
  return ["⏳ COUNTDOWN TO LAUNCH", `🗓 ${days} days · ${hours} hours · ${minutes} minutes`];
}

function progressCaption(percent, now = Date.now()) {
  return [
    "✦ TAY’S STUDIO — OFFICIAL LAUNCH ✦",
    "",
    ...countdownLines(now),
    "",
    `${PROGRESS_MARKER}: ${percent}%`,
    "Final testing · Optimization · Release preparation",
    "",
    "Follow this channel for the official release announcement.",
  ].join("\n");
}

function finalCaption() {
  return [
    "🚀 TAY’S STUDIO IS NOW LIVE",
    "",
    "The wait is over. Thank you for being part of this journey.",
    "Welcome to the next era.",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Operaciones sobre la publicación                                    */
/* ------------------------------------------------------------------ */
let botId = null;
let messageId = null; // publicación de progreso activa
let lastCaption = null;
let lastImageKey = null;
let running = false;
let timer = null;

const imageKey = (percent) => `${percent}|${launchLabel()}`;

async function discoverExistingPost() {
  // 1) Variable de entorno
  if (ENV_MESSAGE_ID) {
    log(`Usando LAUNCH_MESSAGE_ID=${ENV_MESSAGE_ID}`);
    return { id: Number(ENV_MESSAGE_ID), source: "env" };
  }
  // 2) Estado guardado
  const st = loadState();
  if (st.progressMessageId) {
    log(`Usando ID guardado en ${STATE_FILE}: ${st.progressMessageId}`);
    return { id: st.progressMessageId, source: "state" };
  }
  // 3) Mensaje fijado del canal (funciona aunque Railway pierda el disco)
  try {
    const chat = await tg("getChat", { chat_id: CHANNEL });
    const pin = chat.pinned_message;
    if (pin && pin.from?.id === botId && typeof pin.caption === "string") {
      if (pin.caption.includes(PROGRESS_MARKER)) {
        log(`Publicación de progreso recuperada desde el mensaje fijado: ${pin.message_id}`);
        return { id: pin.message_id, source: "pinned" };
      }
      if (pin.caption.includes(FINAL_MARKER)) return { id: pin.message_id, source: "pinned-final" };
    }
  } catch (e) {
    warn(`No se pudo consultar el mensaje fijado: ${e.message}`);
  }
  return null;
}

async function publishProgressPost(percent) {
  const png = await renderPng({ percent, launchLabel: launchLabel() });
  const result = await tg(
    "sendPhoto",
    { chat_id: CHANNEL, photo: "attach://photo", caption: progressCaption(percent) },
    { file: png, retry: false } // sin reintentos de red: evita duplicados
  );
  messageId = result.message_id;
  lastCaption = progressCaption(percent);
  lastImageKey = imageKey(percent);
  saveState({ progressMessageId: messageId });
  log(`Publicación creada. message_id=${messageId}`);
  log(`(Opcional) Guarda LAUNCH_MESSAGE_ID=${messageId} en Railway.`);
  if (PIN_POST) {
    try {
      await tg("pinChatMessage", { chat_id: CHANNEL, message_id: messageId, disable_notification: true });
      log("Publicación fijada.");
    } catch (e) {
      warn(`No se pudo fijar (da permiso de "Pin messages" al bot): ${e.message}`);
    }
  }
}

async function updateProgressPost(percent) {
  const now = Date.now();
  const caption = progressCaption(percent, now);
  const key = imageKey(percent);

  // Imagen + texto cuando cambia el % entero (o en el primer ciclo tras arrancar).
  if (key !== lastImageKey) {
    try {
      const png = await renderPng({ percent, launchLabel: launchLabel() });
      await tg(
        "editMessageMedia",
        {
          chat_id: CHANNEL,
          message_id: messageId,
          media: { type: "photo", media: "attach://photo", caption },
        },
        { file: png }
      );
      lastImageKey = key;
      lastCaption = caption;
      log(`Imagen y texto actualizados (${percent}%).`);
      return;
    } catch (e) {
      if (isNotModified(e)) {
        lastImageKey = key;
        lastCaption = caption;
        return;
      }
      if (isMessageGone(e)) throw e;
      errlog(`Falló la actualización de la imagen (${e.message}). Intento actualizar solo el texto.`);
      // continúa para actualizar el texto
    }
  }

  if (caption === lastCaption) return; // nada que actualizar
  try {
    await tg("editMessageCaption", { chat_id: CHANNEL, message_id: messageId, caption });
    lastCaption = caption;
    log(`Texto actualizado (${percent}%).`);
  } catch (e) {
    if (isNotModified(e)) {
      lastCaption = caption;
      return;
    }
    throw e;
  }
}

async function announceLaunch() {
  log("Hora de lanzamiento alcanzada: publicando anuncio final…");
  const png = await renderPng({ percent: 100, launchLabel: launchLabel(), final: true });
  const reply_markup = FINAL_LINK_URL
    ? { inline_keyboard: [[{ text: FINAL_LINK_TEXT, url: FINAL_LINK_URL }]] }
    : undefined;
  const result = await tg(
    "sendPhoto",
    {
      chat_id: CHANNEL,
      photo: "attach://photo",
      caption: finalCaption(),
      ...(reply_markup ? { reply_markup } : {}),
    },
    { file: png, retry: false }
  );
  saveState({ announcedLaunchAt: LAUNCH_AT, finalMessageId: result.message_id, progressMessageId: null });
  log(`Anuncio final publicado. message_id=${result.message_id}`);

  // Quitar la publicación de progreso
  if (messageId) {
    try {
      await tg("deleteMessage", { chat_id: CHANNEL, message_id: messageId });
      log("Publicación de progreso eliminada.");
    } catch (e) {
      warn(`No se pudo eliminar la publicación de progreso (bórrala manualmente): ${e.message}`);
    }
    messageId = null;
  }
  if (PIN_POST) {
    try {
      await tg("pinChatMessage", { chat_id: CHANNEL, message_id: result.message_id, disable_notification: true });
    } catch (e) {
      warn(`No se pudo fijar el anuncio final: ${e.message}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Ciclo principal                                                     */
/* ------------------------------------------------------------------ */
let announced = false;
let waitingLogged = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    if (announced) return; // lanzamiento ya anunciado: el servicio queda inactivo

    const now = Date.now();
    const percent = computeProgress(now);
    const launched = now >= launchMs;

    if (launched && FINAL_ENABLED) {
      await announceLaunch();
      announced = true;
      log("Lanzamiento anunciado. El servicio queda inactivo; puedes detenerlo.");
      return;
    }

    if (launched && !messageId) {
      if (!waitingLogged) {
        log("Hora de lanzamiento pasada y sin publicación activa. Activa FINAL_ANNOUNCEMENT_ENABLED=true o retrasa LAUNCH_AT.");
        waitingLogged = true;
      }
      return;
    }

    if (!messageId) {
      await publishProgressPost(percent);
      return;
    }

    try {
      await updateProgressPost(percent);
    } catch (e) {
      if (isMessageGone(e)) {
        warn(`La publicación ${messageId} ya no existe (${e.message}). Se creará una nueva.`);
        messageId = null;
        lastCaption = lastImageKey = null;
        saveState({ progressMessageId: null });
        if (!launched) await publishProgressPost(percent);
        return;
      }
      throw e;
    }
    if (launched && !waitingLogged) {
      log("Hora de lanzamiento alcanzada. Anuncio final DESACTIVADO (FINAL_ANNOUNCEMENT_ENABLED=false): la barra se queda al 100 %.");
      waitingLogged = true;
    }
  } catch (e) {
    errlog(`Ciclo fallido: ${e.message}`); // nunca detiene el proceso
  } finally {
    running = false;
  }
}

function scheduleNext() {
  // Alinea los ciclos al inicio de cada minuto.
  const delay = TICK_MS - (Date.now() % TICK_MS) + 250;
  timer = setTimeout(async () => {
    await tick();
    scheduleNext();
  }, delay);
}

async function main() {
  log("Iniciando TAY’S STUDIO launch bot");
  log(`Canal: ${CHANNEL} | Inicio: ${PROGRESS_START_AT} | Lanzamiento: ${LAUNCH_AT} | Progreso inicial: ${START_PROGRESS}%`);
  log(`Anuncio final: ${FINAL_ENABLED ? "ACTIVADO" : "desactivado"}`);

  const me = await tg("getMe");
  botId = me.id;
  log(`Bot: @${me.username}`);

  const st = loadState();
  const found = await discoverExistingPost();
  if (st.announcedLaunchAt === LAUNCH_AT || found?.source === "pinned-final") {
    announced = true;
    log("El anuncio final ya fue publicado. Servicio inactivo.");
  } else if (found && found.source !== "pinned-final") {
    messageId = found.id;
  } else {
    log("No hay publicación existente: se creará una nueva.");
  }

  await tick();
  scheduleNext();
}

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    log(`${sig} recibido. Cerrando.`);
    if (timer) clearTimeout(timer);
    process.exit(0);
  });
}
process.on("unhandledRejection", (e) => errlog("unhandledRejection:", e?.message || e));

main().catch((e) => {
  errlog("Arranque fallido:", e.message);
  process.exit(1);
});
