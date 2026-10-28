"use strict";
// Genera previews PNG locales sin usar Telegram: node preview.js [porcentaje] [final]
const fs = require("node:fs");
const { renderPng } = require("./render");

(async () => {
  const percent = Number(process.argv[2] ?? 85);
  const final = process.argv[3] === "final";
  const png = await renderPng({ percent, launchLabel: "OCT 31 · 8:00 PM (UTC-6)", final });
  const out = `preview-${final ? "final" : percent}.png`;
  fs.writeFileSync(out, png);
  console.log(`Guardado ${out} (${png.length} bytes)`);
})();
