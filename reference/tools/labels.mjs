// Flat contact sheet of every disc label exactly as it is textured (art, logo, title, rim),
// for placing logos and checking palettes without the 3D view.
// Starts its own Vite dev server (port 5195). node reference/tools/labels.mjs [prefix] [px per label, default 280]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.join(root, 'validation');
mkdirSync(OUT, { recursive: true });
const [prefix = 'labels', px = 280] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)('playwright');
const { createServer } = await import(path.join(root, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root, server: { port: 5195, strictPort: true }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  // The site itself loads the label fonts; then reuse its modules.
  await page.goto('http://localhost:5195/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(async (px) => {
    const { labelTexture } = await import('/src/three/discAssets.ts');
    const { projects } = await import('/src/content/projects.ts');
    const urls = await Promise.all(projects.map(async (p) => (await labelTexture(p))?.image.toDataURL()));
    document.body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(${Math.floor(1468 / (px + 16))},${px}px);gap:16px;padding:16px;background:#777;font:12px sans-serif">${
      urls.map((u, i) => `<figure style="margin:0"><img src="${u}" width="${px}" height="${px}"><figcaption>${projects[i].slug}</figcaption></figure>`).join('')}</div>`;
    await Promise.all([...document.images].map((i) => i.decode()));
  }, +px);
  await page.screenshot({ path: path.join(OUT, `${prefix}.png`), fullPage: true });
} finally {
  await browser.close();
  await server.close();
}
