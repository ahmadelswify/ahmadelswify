// Bakes the profile banner: the name in solid type, a monospace role line and a blinking cursor.
// Text stays vector, with fonts embedded so every OS draws the same glyphs (Inter and JetBrains
// Mono, both SIL OFL, tools/fonts/). The cursor is the only motion, so the browser barely repaints.
//
//   node tools/banner.mjs   → assets/banner-dark.svg, assets/banner-light.svg

import { readFileSync, writeFileSync } from "node:fs";

const W = 1300, H = 286;
const NAME = "Ahmad Elswify";
const ROLE = "forward deployed engineer @ augmeta";
const ROLE_Y = 198;
const CHAR_W = 16.8; // JetBrains Mono advance at 28px
const CURSOR_X = 62 + (ROLE.length + 2) * CHAR_W + 6;

const THEMES = {
  dark: { bg: "#060706", name: "#ededf0", muted: "#a0a0a8", accent: "#ff2a1f" },
  light: { bg: "#f6f6f2", name: "#111113", muted: "#55555c", accent: "#e0261b" },
};

const face = (family, file) => {
  const data = readFileSync(new URL(`./fonts/${file}`, import.meta.url)).toString("base64");
  return `@font-face{font-family:${family};font-weight:500;src:url(data:font/woff2;base64,${data}) format("woff2")}`;
};

function svg(c) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Ahmad Elswify, forward deployed engineer at Augmeta">
<!-- Fonts: Inter, Copyright 2016 The Inter Project Authors; JetBrains Mono, Copyright 2020 The JetBrains Mono Project Authors; SIL Open Font License 1.1 -->
<style>
${face("I", "Inter-latin-500.woff2")}
${face("M", "JetBrainsMono-latin-500.woff2")}
.name{font:500 84px I,system-ui,sans-serif;letter-spacing:-2px;fill:${c.name}}
.role{font:500 28px M,ui-monospace,Menlo,Consolas,monospace;fill:${c.muted}}
.mark{fill:${c.accent}}
.cursor{fill:${c.accent};animation:blink 1.1s step-end infinite}
@keyframes blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){.cursor{animation:none}}
</style>
<rect width="100%" height="100%" rx="12" fill="${c.bg}"/>
<text class="name" x="60" y="146">${NAME}</text>
<text class="role" x="62" y="${ROLE_Y}"><tspan class="mark">&gt; </tspan>${ROLE}</text>
<rect class="cursor" x="${CURSOR_X}" y="${ROLE_Y - 23}" width="15" height="28"/>
</svg>
`;
}

for (const theme of Object.keys(THEMES)) {
  const s = svg(THEMES[theme]);
  writeFileSync(new URL(`../assets/banner-${theme}.svg`, import.meta.url), s);
  console.log(`banner-${theme}.svg  ${(s.length / 1024).toFixed(0)} KB`);
}
