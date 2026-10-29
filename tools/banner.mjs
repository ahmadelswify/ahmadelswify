// Bakes the profile banner: an animated ASCII glyph field as a self-contained SVG.
// GitHub renders README images with no JS, so all motion is CSS inside the file, and it has to be
// cheap: an animated SVG in an <img> is repainted whole on every frame.
//  - the glyph field is rasterized once (by the local Chrome) into a two-tone PNG, so each frame
//    draws one image instead of ~3,000 text glyphs
//  - two "fog" images in the background colour slide over it in opposite directions; where both
//    thin out the glyphs show, so lit patches drift, grow and shrink continuously
//  - the name and tagline stay vector text on top, crisp at any size
// Measured in headless Chrome: SVG masks ~15fps, fog over live text ~40fps, fog over the baked field 60fps.
// The font (JetBrains Mono, SIL OFL, tools/fonts/) is embedded so every OS draws the same glyphs.
//
//   node tools/banner.mjs   → assets/banner-dark.svg, assets/banner-light.svg  (needs Chrome; set CHROME= if not at the macOS default path)

import { writeFileSync, mkdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode, encode, fromPixels } from "./lib/png.mjs";
import { rasterize } from "./lib/rasterize.mjs";

const COLS = 130;
const ROWS = 26;
const CW = 10; // cell size in SVG px
const CH = 16;
const W = COLS * CW, H = ROWS * CH;

const FOG_A_S = 48; // seconds for the main fog to slide one full banner width
const FOG_B_S = 77; // the second fog drifts the other way, slower; where both thin out, glyphs show
const DENSITY_BIAS = 0.17;
const ACCENT_THRESHOLD = 0.49; // ~top 15% of the accent noise, as in the original effect

const NAME_LINES = ["AHMAD", "ELSWIFY"];
const PX_W = 2; // each font pixel is 2 cells wide, 1 tall: ~square at 10x16 cells
const TAGLINE = "founding forward deployed engineer @ augmeta";
const NAME_ROW = 4;
const TAGLINE_ROW = NAME_ROW + 7 * NAME_LINES.length + 3;

const THEMES = {
  dark: { bg: "#060706", ink: "#8a8a92", accent: "#ff2a1f", name: "#ededf0", muted: "#8a8a92" },
  light: { bg: "#f6f6f2", ink: "#4a4a52", accent: "#e0261b", name: "#111113", muted: "#55555c" },
};

// --- noise: classic improved Perlin ---
const perm = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 1337;
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function grad(h, x, y, z) {
  const u = (h & 15) < 8 ? x : y;
  const v = (h & 15) < 4 ? y : (h & 15) === 12 || (h & 15) === 14 ? x : z;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}
function perlin3d(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
         lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
         lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
    w);
}

// --- field functions: fbm noise + diagonal bands, per glyph cell ---
// Integer hash → [0, 1). (The shader's fract-based hash repeats every 50 cells on integer inputs.)
function hash21(x, y) {
  let h = (Math.imul(Math.round(x * 97), 374761393) + Math.imul(Math.round(y * 89), 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const noise01 = (x, y, z) => 0.5 + 0.6 * perlin3d(x, y, z);
const fbm = (x, y, z) =>
  noise01(x, y, z) * 0.6 + noise01(x * 2.1, y * 2.1, z * 1.3) * 0.3 + noise01(x * 4.3, y * 4.3, z * 1.7) * 0.1;
// The noise fields wrap in x with period COLS, so a fog can slide one banner width and loop: x is
// sampled around a cylinder (circumference = COLS * scale noise units), which keeps full contrast
// where a blended wrap would flatten the noise mid-banner.
function cylinder(f, cx, cy, scale, yScale, ox, oy) {
  const a = (cx / COLS) * 2 * Math.PI, r = (COLS * scale) / (2 * Math.PI);
  return f(r * Math.cos(a) + ox, r * Math.sin(a) + oy, cy * yScale);
}
const density = (cx, cy) =>
  cylinder(fbm, cx, cy, 0.035, 0.05, 0.37, 5.61) * 0.75 +
  0.25 * (0.5 + 0.5 * Math.sin(((cx + cy * 1.4) * 2 * Math.PI) / COLS)) + DENSITY_BIAS;
const accentNoise = (cx, cy) => cylinder(noise01, cx, cy, 0.03, 0.026, 40.37, 0.29);

// --- fog images: one pixel per cell, upscaled smoothly by the browser ---
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// Fog: the background colour, opaque where the field should be dark. Two banner widths wide so it
// can slide one width and wrap.
const fogPng = (bg, visible) => fromPixels(COLS * 2, ROWS, (x, y) => [...rgb(bg), Math.round(255 * (1 - clamp01(visible(x % COLS, y))))]);
const fogB = (cx, cy) => cylinder(fbm, cx, cy, 0.05, 0.08, 17.3, 9.1);
const FOGS = {
  a: (x, y) => clamp01((density(x, y) - 0.54) / 0.24),
  b: (x, y) => clamp01((fogB(x, y) - 0.22) / 0.28),
};

// --- glyph-style name: a 5x7 block font, one cell per pixel ---
const FONT = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
};
const nameMask = new Set();
const lineWidth = (s) => (s.length * 6 - 1) * PX_W;
const nameWidth = Math.max(...NAME_LINES.map(lineWidth));
const nameCol = Math.floor((COLS - nameWidth) / 2);
NAME_LINES.forEach((line, l) =>
  [...line].forEach((ch, i) =>
    FONT[ch].forEach((row, r) =>
      [...row].forEach((px, c) => {
        if (px !== "#") return;
        for (let k = 0; k < PX_W; k++) nameMask.add(`${nameCol + (i * 6 + c) * PX_W + k},${NAME_ROW + l * 8 + r}`);
      }))));
const tagCol = nameCol;

// The card the field stays clear of (in px), with a soft baked fade around it.
const CARD = { x: (nameCol - 3) * CW, y: (NAME_ROW - 1.5) * CH, w: (nameWidth + 6) * CW, h: (TAGLINE_ROW - NAME_ROW + 3) * CH };
const inCard = (cx, cy) => cx * CW >= CARD.x && (cx + 1) * CW <= CARD.x + CARD.w && cy * CH >= CARD.y && (cy + 1) * CH <= CARD.y + CARD.h;

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const FAINT = ".·:";
const NAME_GLYPHS = "#@%&80BMNWX";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Rows of text for one sparse layer: each row starts at its first glyph and is stretched to the grid.
function rows(glyphAt) {
  let out = "";
  for (let cy = 0; cy < ROWS; cy++) {
    const chars = Array.from({ length: COLS }, (_, cx) => (inCard(cx, cy) ? " " : glyphAt(cx, cy) ?? " "));
    const first = chars.findIndex((c) => c !== " ");
    if (first < 0) continue;
    const last = COLS - 1 - [...chars].reverse().findIndex((c) => c !== " ");
    const text = chars.slice(first, last + 1).join("");
    out += `<text x="${first * CW}" y="${(cy + 1) * CH - 4}" textLength="${text.length * CW}">${esc(text)}</text>`;
  }
  return out;
}

// The static field: about a third of the cells are faint dots, the rest letters; letters in the
// accent clusters are red.
const isDot = (cx, cy) => hash21(cx + 5.5, cy + 1.7) < 0.35;
const isRed = (cx, cy) => accentNoise(cx, cy) > ACCENT_THRESHOLD;
const letter = (cx, cy) => ALNUM[Math.floor(hash21(cx, cy + 11.9) * ALNUM.length)];
// Baked in reference colours; recolored per theme after rasterizing (see twoTone).
const REF = { ink: "#8a8a92", accent: "#ff2a1f" };
const fieldSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<style>@font-face{font-family:G;font-weight:700;src:url(data:font/woff2;base64,${readFileSync(new URL("./fonts/JetBrainsMono-latin-700.woff2", import.meta.url)).toString("base64")}) format("woff2")}
text{font:700 13px G,monospace;white-space:pre}</style>
<g transform="translate(0 2)">
<g fill="${REF.ink}" fill-opacity=".35">${rows((cx, cy) => (isDot(cx, cy) ? FAINT[Math.floor(hash21(cx + 2.2, cy + 9.4) * 3)] : null))}</g>
<g fill="${REF.ink}" fill-opacity=".62">${rows((cx, cy) => (!isDot(cx, cy) && !isRed(cx, cy) ? letter(cx, cy) : null))}</g>
<g fill="${REF.accent}">${rows((cx, cy) => (!isDot(cx, cy) && isRed(cx, cy) ? letter(cx, cy) : null))}</g>
</g></svg>`;
// Snap each visible pixel to the theme's ink or accent, keeping its coverage in alpha. Two solid
// colours compress far better than the anti-aliased screenshot.
function twoTone(field, theme) {
  const ink = rgb(theme.ink), accent = rgb(theme.accent), data = Buffer.from(field.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) { data[i] = data[i + 1] = data[i + 2] = 0; continue; }
    data.set(data[i] - (data[i + 1] + data[i + 2]) / 2 > 40 ? accent : ink, i);
  }
  return encode(field.w, field.h, data);
}
// Static fade around the card, in the background colour (baked, so no live blur filter).
const cardDist = (cx, cy) => {
  const dx = Math.max(CARD.x - (cx + 0.5) * CW, (cx + 0.5) * CW - (CARD.x + CARD.w), 0) / CW;
  const dy = Math.max(CARD.y - (cy + 0.5) * CH, (cy + 0.5) * CH - (CARD.y + CARD.h), 0) / CH;
  return Math.hypot(dx, dy * 1.6);
};
const cardFade = (bg) => fromPixels(COLS, ROWS, (x, y) => [...rgb(bg), Math.round(255 * (1 - clamp01((cardDist(x, y) - 0.5) / 3)))]);

const nameCells = [...nameMask].map((k) => k.split(",").map(Number));
const nameBlocks = nameCells.map(([cx, cy]) => `<rect x="${cx * CW}" y="${cy * CH}" width="${CW}" height="${CH}"/>`).join("");
const nameGlyphs = nameCells.map(([cx, cy]) =>
  `<text x="${cx * CW + CW / 2}" y="${(cy + 1) * CH - 3.5}">${esc(NAME_GLYPHS[Math.floor(hash21(cx, cy) * NAME_GLYPHS.length)])}</text>`).join("");
const tagline = `<text x="${tagCol * CW}" y="${(TAGLINE_ROW + 1) * CH - 4}" textLength="${(TAGLINE.length + 2) * CW}"><tspan class="a">&gt; </tspan><tspan class="m">${esc(TAGLINE)}</tspan></text>`;

const font = readFileSync(new URL("./fonts/JetBrainsMono-latin-700.woff2", import.meta.url)).toString("base64");
const image = (buf, w, cls = "") =>
  `<image${cls ? ` class="${cls}"` : ""} href="data:image/png;base64,${buf.toString("base64")}" width="${w}" height="${H}" preserveAspectRatio="none"/>`;

function svg(theme, field) {
  const c = THEMES[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Ahmad Elswify: founding forward deployed engineer at Augmeta">
<!-- Font: JetBrains Mono, Copyright 2020 The JetBrains Mono Project Authors, SIL Open Font License 1.1 -->
<style>
@font-face{font-family:G;font-weight:700;src:url(data:font/woff2;base64,${font}) format("woff2")}
text{font:700 13px G,ui-monospace,Menlo,Consolas,monospace;white-space:pre}
.nb{fill:${c.name};fill-opacity:.13}.n text{fill:${c.name};font-size:14px;text-anchor:middle}
.tag text{font-size:15px}.a{fill:${c.accent}}.m{fill:${c.muted}}
.fa{animation:drift ${FOG_A_S}s linear infinite}
.fb{animation:drift ${FOG_B_S}s linear infinite reverse}
@keyframes drift{from{transform:translateX(0)}to{transform:translateX(-${W}px)}}
@media (prefers-reduced-motion:reduce){.fa,.fb{animation:none}}
</style>
<rect width="100%" height="100%" rx="10" fill="${c.bg}"/>
${image(twoTone(field, c), W)}
${image(fogPng(c.bg, FOGS.a), W * 2, "fa")}
${image(fogPng(c.bg, FOGS.b), W * 2, "fb")}
${image(cardFade(c.bg), W)}
<g class="nb" transform="translate(0 2)">${nameBlocks}</g>
<g class="n" transform="translate(0 2)">${nameGlyphs}</g>
<g class="tag" transform="translate(0 2)">${tagline}</g>
</svg>
`;
}

const work = mkdtempSync(join(tmpdir(), "banner-"));
try {
  const fieldPath = join(work, "field.svg");
  writeFileSync(fieldPath, fieldSvg);
  const field = decode(await rasterize(fieldPath, W, H));
  mkdirSync(new URL("../assets/", import.meta.url), { recursive: true });
  for (const theme of Object.keys(THEMES)) {
    const s = svg(theme, field);
    writeFileSync(new URL(`../assets/banner-${theme}.svg`, import.meta.url), s);
    console.log(`banner-${theme}.svg  ${(s.length / 1024).toFixed(0)} KB`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
