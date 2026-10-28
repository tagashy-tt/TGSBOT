"use strict";
/**
 * Renderizado de la imagen de progreso.
 *
 * Todo el texto se convierte a trazados vectoriales (paths) con opentype.js
 * usando fuentes incluidas en /fonts. Así la imagen NO depende de las fuentes
 * del sistema de Railway y nunca aparecen cuadrados / glifos ausentes.
 */
const path = require("node:path");
const opentype = require("opentype.js");
const sharp = require("sharp");

const regular = opentype.loadSync(path.join(__dirname, "fonts", "SpaceGrotesk_400Regular.ttf"));
const bold = opentype.loadSync(path.join(__dirname, "fonts", "SpaceGrotesk_700Bold.ttf"));

const W = 1280;
const H = 720;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Devuelve un <path> SVG con el texto. anchor: "start" | "end" | "middle". */
function text(str, { x, y, size, font = regular, fill = "#fff", spacing = 0, anchor = "start", opacity = 1 }) {
  const ls = spacing * size; // spacing en em
  const opts = { letterSpacing: spacing };
  const width = font.getAdvanceWidth(str, size, opts);
  let px = x;
  if (anchor === "end") px = x - width;
  if (anchor === "middle") px = x - width / 2;
  const d = font.getPath(str, px, y, size, opts).toPathData(2);
  void ls;
  return `<path d="${d}" fill="${fill}" fill-opacity="${opacity}"/>`;
}

function textWidth(str, size, font = regular, spacing = 0) {
  return font.getAdvanceWidth(str, size, { letterSpacing: spacing });
}

/**
 * @param {object} o
 * @param {number} o.percent       porcentaje entero 0-100
 * @param {string} o.launchLabel   ej. "31 OCT · 8:00 PM (UTC-6)"
 * @param {boolean} [o.final]      versión "ya disponible"
 */
function buildSvg({ percent, launchLabel, final = false }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const barX = 96, barY = 520, barW = 1088, barH = 30;
  const fillW = Math.max(barH, Math.round((barW * p) / 100)); // mínimo = punta redondeada visible
  const tipX = barX + fillW;

  const ticks = Array.from({ length: 9 }, (_, i) => {
    const tx = barX + ((i + 1) * barW) / 10;
    return `<line x1="${tx}" y1="${barY - 10}" x2="${tx}" y2="${barY + barH + 10}" stroke="#2a1d3d" stroke-width="2"/>`;
  }).join("");

  const pctStr = `${p}`;
  const pctSize = 190;
  const pctW = textWidth(pctStr, pctSize, bold, -0.02);

  const title = final ? "NOW LIVE" : "LAUNCH PROGRESS";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#6D28D9"/>
      <stop offset="55%" stop-color="#A78BFA"/>
      <stop offset="100%" stop-color="#E9D5FF"/>
    </linearGradient>
    <linearGradient id="pctGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#C4B5FD"/>
    </linearGradient>
    <radialGradient id="glowA" cx="85%" cy="8%" r="70%">
      <stop offset="0%" stop-color="#3B1566" stop-opacity=".85"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="5%" cy="100%" r="55%">
      <stop offset="0%" stop-color="#2A0E4A" stop-opacity=".55"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <filter id="blur" x="-20%" y="-300%" width="140%" height="700%">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
    <filter id="blurSoft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6"/>
    </filter>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M48 0H0V48" fill="none" stroke="#ffffff" stroke-opacity=".035" stroke-width="1"/>
    </pattern>
  </defs>

  <rect width="${W}" height="${H}" fill="#000000"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" fill="url(#glowA)"/>
  <rect width="${W}" height="${H}" fill="url(#glowB)"/>
  <rect x="32" y="32" width="${W - 64}" height="${H - 64}" rx="28" fill="none" stroke="#3A2552" stroke-width="2"/>
  <path d="M32 120 V60 a28 28 0 0 1 28 -28 H140" fill="none" stroke="#A78BFA" stroke-width="3" stroke-linecap="round"/>
  <path d="M${W - 32} ${H - 120} V${H - 60} a28 28 0 0 1 -28 28 H${W - 140}" fill="none" stroke="#A78BFA" stroke-width="3" stroke-linecap="round"/>

  <!-- Marca -->
  <rect x="96" y="82" width="8" height="54" rx="4" fill="url(#accent)"/>
  ${text("TAY’S STUDIO", { x: 122, y: 108, size: 30, font: bold, fill: "#DDD0FF", spacing: 0.18 })}
  ${text("OFFICIAL LAUNCH CHANNEL", { x: 122, y: 134, size: 15, fill: "#8F7FA6", spacing: 0.28 })}

  <!-- Estado -->
  <rect x="${W - 96 - 230}" y="84" width="230" height="46" rx="23" fill="#14091F" stroke="#4C2A7A" stroke-width="2"/>
  <circle cx="${W - 96 - 230 + 28}" cy="107" r="6" fill="#C4B5FD"/>
  <circle cx="${W - 96 - 230 + 28}" cy="107" r="11" fill="#A78BFA" opacity=".35" filter="url(#blurSoft)"/>
  ${text(final ? "LIVE" : "IN PROGRESS", { x: W - 96 - 230 + 50, y: 114, size: 18, font: bold, fill: "#E9D5FF", spacing: 0.16 })}

  <!-- Titular -->
  ${text(title, { x: 96, y: 232, size: 26, fill: "#A78BFA", spacing: 0.3 })}
  ${text(final ? "TAY’S STUDIO is here." : "The next era is almost here.", { x: 96, y: 290, size: 46, font: bold, fill: "#FFFFFF", spacing: -0.01 })}
  ${text(final ? "Download it now." : "Final testing · Optimization · Release preparation", { x: 96, y: 336, size: 22, fill: "#A596BA" })}

  <!-- Porcentaje -->
  ${text(pctStr, { x: 96, y: 492, size: pctSize, font: bold, fill: "url(#pctGrad)", spacing: -0.02 })}
  ${text("%", { x: 96 + pctW + 14, y: 492, size: 90, font: bold, fill: "#A78BFA" })}

  <!-- Fecha objetivo -->
  ${text(final ? "LAUNCHED" : "TARGET LAUNCH", { x: W - 96, y: 420, size: 15, fill: "#8F7FA6", spacing: 0.28, anchor: "end" })}
  ${text(launchLabel, { x: W - 96, y: 456, size: 28, font: bold, fill: "#EDE4FF", anchor: "end" })}

  <!-- Barra -->
  <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="#140E1D" stroke="#2A1D3D" stroke-width="2"/>
  <rect x="${barX}" y="${barY}" width="${fillW}" height="${barH}" rx="${barH / 2}" fill="url(#accent)" filter="url(#blur)" opacity=".75"/>
  <rect x="${barX}" y="${barY}" width="${fillW}" height="${barH}" rx="${barH / 2}" fill="url(#accent)"/>
  ${ticks}
  <circle cx="${tipX - barH / 2}" cy="${barY + barH / 2}" r="6" fill="#FFFFFF"/>
  ${text("0%", { x: barX, y: barY + 72, size: 16, fill: "#6F6083", spacing: 0.1 })}
  ${text("50%", { x: barX + barW / 2, y: barY + 72, size: 16, fill: "#6F6083", spacing: 0.1, anchor: "middle" })}
  ${text("100%", { x: barX + barW, y: barY + 72, size: 16, fill: "#6F6083", spacing: 0.1, anchor: "end" })}

  ${text(esc("BUILT FOR CREATORS · TAY’S STUDIO").replace(/&amp;/g, "&"), { x: W / 2, y: H - 52, size: 14, fill: "#5B4D6E", spacing: 0.3, anchor: "middle" })}
</svg>`;
}

async function renderPng(opts) {
  return sharp(Buffer.from(buildSvg(opts)), { density: 72 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

module.exports = { renderPng, buildSvg, W, H };
