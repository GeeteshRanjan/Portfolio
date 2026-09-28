// Capture an embed's first screen as its poster, at the width the embed lays out for
// (`game.viewport`, default 600 = the game's rail layout), 16:9.
// node game-poster.js <out.png> [url] [width]
//   ANSRcade:  node game-poster.js ../../public/images/ansrcade-poster.png
//   GCC Atlas: node game-poster.js /tmp/gcc.png https://gcc-landscape.vercel.app/ 900
// Convert to JPEG afterwards (e.g. `sips -s format jpeg -s formatOptions 82 in.png --out out.jpg`).
const { chromium } = require('playwright');
(async () => {
  const [out = '../../public/images/ansrcade-poster.png', url = 'https://ansrcade.vercel.app/', w = '600'] = process.argv.slice(2);
  const width = Number(w);
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width, height: Math.round(width * 9 / 16) }, deviceScaleFactor: 1380 / width });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out });
  await b.close();
})();
