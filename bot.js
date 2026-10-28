const sharp = require("sharp");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL = process.env.TELEGRAM_CHANNEL;
const LAUNCH_AT = process.env.LAUNCH_AT || "2026-10-31T20:00:00-06:00";
const PROGRESS = Number(process.env.LAUNCH_PROGRESS ?? "85");
const MESSAGE_ID_RAW = process.env.LAUNCH_MESSAGE_ID || "";
const UPDATE_INTERVAL_MS = 60_000;

if (!TOKEN || !CHANNEL) {
  throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL.");
}
if (!Number.isFinite(Date.parse(LAUNCH_AT))) {
  throw new Error("LAUNCH_AT must be a valid ISO-8601 date/time.");
}
if (!Number.isFinite(PROGRESS) || PROGRESS < 0 || PROGRESS > 100) {
  throw new Error("LAUNCH_PROGRESS must be a number from 0 to 100.");
}

const API = `https://api.telegram.org/bot${TOKEN}`;
let messageId = MESSAGE_ID_RAW ? Number(MESSAGE_ID_RAW) : null;
if (messageId !== null && !Number.isInteger(messageId)) {
  throw new Error("LAUNCH_MESSAGE_ID must be an integer.");
}

async function telegram(method, fields, file) {
  let response;
  if (file) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    form.append("photo", new Blob([file], { type: "image/png" }), "launch.png");
    response = await fetch(`${API}/${method}`, { method: "POST", body: form });
  } else {
    response = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields)
    });
  }

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`${method}: ${data.description || response.status}`);
  }
  return data.result;
}

function countdownText() {
  const remaining = Math.max(0, Date.parse(LAUNCH_AT) - Date.now());
  if (remaining === 0) {
    return "🚀 LAUNCH DAY — TAY’S STUDIO is scheduled to launch!";
  }

  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);

  return [
    "⏳ COUNTDOWN TO LAUNCH",
    `🗓 ${days} days · ${hours} hours`,
    `⏱ ${minutes} minutes · ${seconds} seconds`,
    "",
    "Follow this channel for the official release announcement."
  ].join("\n");
}

function caption() {
  return [
    "✦ TAY’S STUDIO — OFFICIAL LAUNCH ✦",
    "",
    countdownText(),
    "",
    `LAUNCH PROGRESS: ${PROGRESS}%`,
    "Final testing · Optimization · Release preparation"
  ].join("\n");
}

function svgArtwork(progress) {
  const width = 1200, height = 675;
  const x = 92, barY = 474, barW = 1016, barH = 22;
  const fillW = Math.round(barW * progress / 100);
  const marks = Array.from({ length: 10 }, (_, i) => {
    const mx = x + i * (barW / 10);
    return `<line x1="${mx}" y1="${barY - 8}" x2="${mx}" y2="${barY + barH + 8}" stroke="#241a31" stroke-width="2"/>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#8B5CF6"/><stop offset="100%" stop-color="#D8B4FE"/>
      </linearGradient>
      <radialGradient id="glow" cx="80%" cy="15%" r="75%">
        <stop offset="0%" stop-color="#31134B" stop-opacity=".75"/><stop offset="100%" stop-color="#050507" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="675" fill="#050507"/>
    <rect width="1200" height="675" fill="url(#glow)"/>
    <rect x="34" y="34" width="1132" height="607" rx="26" fill="none" stroke="#30203D" stroke-width="2"/>
    <rect x="66" y="68" width="8" height="58" rx="4" fill="url(#accent)"/>
    <text x="96" y="92" font-family="Arial, Helvetica, sans-serif" font-size="23" letter-spacing="5" fill="#C4A3FF">TAY’S STUDIO</text>
    <text x="96" y="121" font-family="Arial, Helvetica, sans-serif" font-size="14" letter-spacing="4" fill="#81728F">OFFICIAL LAUNCH CHANNEL</text>
    <text x="92" y="229" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="60" fill="#FFFFFF">THE NEXT ERA</text>
    <text x="92" y="300" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="60" fill="#D8B4FE">IS ALMOST HERE.</text>
    <text x="94" y="356" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="#B9ADc7">Final testing. Performance tuning. Release preparation.</text>
    <text x="92" y="431" font-family="Arial, Helvetica, sans-serif" font-size="18" letter-spacing="3" fill="#C4A3FF">LAUNCH PROGRESS</text>
    <text x="1108" y="431" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="700" fill="#FFFFFF">${progress}%</text>
    <rect x="${x}" y="${barY}" width="${barW}" height="${barH}" rx="11" fill="#211B29"/>
    <rect x="${x}" y="${barY}" width="${Math.max(0, Math.min(barW, fillW))}" height="${barH}" rx="11" fill="url(#accent)"/>
    ${marks}
    <text x="92" y="551" font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#9B8BA8">COUNTDOWN UPDATES AUTOMATICALLY IN THE POST CAPTION</text>
    <text x="92" y="600" font-family="Arial, Helvetica, sans-serif" font-size="14" letter-spacing="3" fill="#6E607B">BUILT FOR CREATORS · TAY’S STUDIO</text>
  </svg>`;
}

async function makeArtwork() {
  return sharp(Buffer.from(svgArtwork(PROGRESS)))
    .png()
    .toBuffer();
}

async function publishOrUpdate() {
  const image = await makeArtwork();
  const postCaption = caption();

  if (messageId) {
    // Refresh the graphical progress image and its caption in the same channel post.
    const media = {
      type: "photo",
      media: "attach://photo",
      caption: postCaption
    };
    const result = await telegram("editMessageMedia", {
      chat_id: CHANNEL,
      message_id: messageId,
      media
    }, image);
    console.log("Updated launch post:", result.message_id);
  } else {
    const result = await telegram("sendPhoto", {
      chat_id: CHANNEL,
      photo: "attach://photo",
      caption: postCaption
    }, image);
    messageId = result.message_id;
    console.log("");
    console.log("Launch post created. Save this ID as LAUNCH_MESSAGE_ID in Railway:");
    console.log(String(messageId));
    console.log("Then restart the service to keep updating the same post after restarts.");
    try {
      await telegram("pinChatMessage", {
        chat_id: CHANNEL,
        message_id: messageId,
        disable_notification: true
      });
      console.log("Launch post pinned.");
    } catch (err) {
      console.warn("Could not pin automatically. Pin it manually in Telegram:", err.message);
    }
  }
}

async function main() {
  await publishOrUpdate();
  setInterval(() => {
    // Rebuild the countdown caption each minute; the image also reflects the configured progress.
    publishOrUpdate().catch(err => console.error("Launch post update failed:", err.message));
  }, UPDATE_INTERVAL_MS);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
