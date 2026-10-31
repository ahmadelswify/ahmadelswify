// Draws the Augmeta mark for the README: the four bars of augmeta.ai/bars-logo.png as vector shapes
// (same colours and proportions) so they can slowly breathe, inside red corner brackets.
// One theme-neutral file: GitHub drops a <picture> that sits inside a link, so light/dark variants
// would lose either the theme switch or the link.
//
//   node tools/logo.mjs   → assets/augmeta.svg

import { writeFileSync } from "node:fs";

const CARD = 200; // card size in SVG px
const PAD = 10; // gap between the card and the corner brackets
const ARM = 20; // bracket arm length
const SCALE = 0.424; // logo units (500px source) → SVG px; the bars fill ~85% of the card
const W = CARD + PAD * 2;

const C = { accent: "#ef2a1f", frame: "#8a8a92" }; // readable on GitHub's light and dark

// Measured from the source logo: left edge x=46, each bar's top y, width and colour.
const LEFT = 46, BAR_H = 69, RADIUS = 12;
const BARS = [
  { y: 46, width: 296, color: "#f0c233", delay: 0 },
  { y: 160, width: 400, color: "#91c47d", delay: -2.6 },
  { y: 273, width: 351, color: "#e69137", delay: -5.1 },
  { y: 387, width: 210, color: "#d5a6be", delay: -1.3 },
];
const OFFSET = PAD + (CARD - 500 * SCALE) / 2;
const px = (v) => (OFFSET + v * SCALE).toFixed(1);

// One L-shaped bracket per corner, opening toward the card.
const brackets = [
  [1, 1, 1, 1], [W - 1, 1, -1, 1], [1, W - 1, 1, -1], [W - 1, W - 1, -1, -1],
].map(([x, y, dx, dy]) => `<path d="M${x + dx * ARM} ${y}H${x}V${y + dy * ARM}"/>`).join("");

const bars = BARS.map((b) =>
  `<rect class="bar" x="${px(LEFT)}" y="${px(b.y)}" width="${(b.width * SCALE).toFixed(1)}" height="${(BAR_H * SCALE).toFixed(1)}" rx="${(RADIUS * SCALE).toFixed(1)}" fill="${b.color}" style="animation-delay:${b.delay}s"/>`).join("\n");

const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" role="img" aria-label="Augmeta logo">
<style>
.bar{transform-box:fill-box;transform-origin:left center;animation:breathe 7s ease-in-out infinite alternate}
@keyframes breathe{from{transform:scaleX(.8)}to{transform:scaleX(1)}}
@media (prefers-reduced-motion:reduce){.bar{animation:none}}
</style>
<rect x="${PAD}" y="${PAD}" width="${CARD}" height="${CARD}" rx="8" fill="none" stroke="${C.frame}" stroke-opacity=".45"/>
${bars}
<g fill="none" stroke="${C.accent}" stroke-width="2" stroke-linecap="square">${brackets}</g>
</svg>
`;

writeFileSync(new URL("../assets/augmeta.svg", import.meta.url), out);
console.log(`augmeta.svg  ${(out.length / 1024).toFixed(1)} KB`);
