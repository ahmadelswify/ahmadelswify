// Rasterize an SVG file to a transparent PNG with the local Chrome, over the DevTools protocol.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function rasterize(svgPath, width, height) {
  const profile = mkdtempSync(join(tmpdir(), "banner-chrome-"));
  const port = 9400 + Math.floor(Math.random() * 500);
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, "--hide-scrollbars", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
    }
    if (!target) throw new Error(`Chrome didn't start (set CHROME=/path/to/chrome)`);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    let id = 0; const pending = new Map();
    ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send("Page.navigate", { url: pathToFileURL(svgPath).href });
    await sleep(1500); // let the embedded font load
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } });
    ws.close();
    return Buffer.from(shot.result.data, "base64");
  } finally {
    const exited = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
