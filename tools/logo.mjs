// Frames the Augmeta mark for the README's whoami section: the official mark (augmeta.ai/bars-logo.png)
// with the glyph styling kept around it: red corner brackets and a monospace caption. The mark is
// embedded because an SVG shown through <img> can't load external files.
// One theme-neutral file (transparent card, mid-grey caption): GitHub drops a <picture> that sits
// inside a link, so light/dark variants would lose either the theme switch or the link.
//
//   node tools/logo.mjs   → assets/augmeta.svg

import { readFileSync, writeFileSync } from "node:fs";

const CARD = 200; // card size in SVG px
const MARK = 212; // mark image size; the source PNG has ~9% transparent margin, so the bars fill ~85% of the card (source is 500px, sharp on 2x screens)
const PAD = 10; // gap between the card and the corner brackets
const ARM = 20; // bracket arm length
const CAPTION = "> founding fde @ augmeta";
const W = CARD + PAD * 2, H = CARD + PAD * 2 + 24;

const C = { accent: "#ef2a1f", ink: "#7d7d86", frame: "#8a8a92" }; // readable on GitHub's light and dark

const mark = readFileSync(new URL("./augmeta-mark.png", import.meta.url)).toString("base64");

// One L-shaped bracket per corner, opening toward the card.
const brackets = [
  [1, 1, 1, 1], [W - 1, 1, -1, 1], [1, W - 1, 1, -1], [W - 1, W - 1, -1, -1],
].map(([x, y, dx, dy]) => `<path d="M${x + dx * ARM} ${y}H${x}V${y + dy * ARM}"/>`).join("");

function svg(c) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Augmeta logo">
<rect x="${PAD}" y="${PAD}" width="${CARD}" height="${CARD}" rx="8" fill="none" stroke="${c.frame}" stroke-opacity=".45"/>
<image href="data:image/png;base64,${mark}" x="${PAD + (CARD - MARK) / 2}" y="${PAD + (CARD - MARK) / 2}" width="${MARK}" height="${MARK}"/>
<g fill="none" stroke="${c.accent}" stroke-width="2" stroke-linecap="square">${brackets}</g>
<text x="${PAD}" y="${H - 6}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="11" font-weight="600" fill="${c.ink}"><tspan fill="${c.accent}">${CAPTION.slice(0, 1)}</tspan>${CAPTION.slice(1)}</text>
</svg>
`;
}

const out = svg(C);
writeFileSync(new URL("../assets/augmeta.svg", import.meta.url), out);
console.log(`augmeta.svg  ${(out.length / 1024).toFixed(0)} KB`);
