// End-to-end check of /admin: starts its own Vite dev server (port 5199), logs in,
// edits + saves + reverts a field, and screenshots every section into validation/.
// node reference/tools/admin-check.mjs
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.join(root, 'validation');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(import.meta.url)('playwright');
const { createServer } = await import(path.join(root, 'node_modules/vite/dist/node/index.js'));

const password = /^ADMIN_PASSWORD=(.*)$/m.exec(readFileSync(path.join(root, '.env.local'), 'utf8'))?.[1]?.trim();
const siteFile = path.join(root, 'src/content/data/site.json');
const original = readFileSync(siteFile, 'utf8');
const results = [];
const ok = (name, pass, extra = '') => { results.push(`${pass ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); };

const server = await createServer({ root, server: { port: 5199, strictPort: true }, logLevel: 'warn' });
await server.listen();
const base = 'http://localhost:5199';
const browser = await chromium.launch();
try {
  // API refuses unauthenticated reads.
  const unauth = await fetch(`${base}/api/admin/content`);
  ok('unauthenticated GET /content is 401', unauth.status === 401);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push(`console: ${m.text()}`); });

  await page.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT, 'admin-login.png') });
  await page.fill('#adm-password', 'wrong-password');
  await page.click('button[type=submit]');
  ok('wrong password rejected', await page.getByText('Wrong password.').waitFor({ timeout: 3000 }).then(() => true, () => false));
  await page.fill('#adm-password', password);
  await page.click('button[type=submit]');
  await page.waitForSelector('.adm-shell');
  await page.waitForSelector('.adm-fields');
  ok('logged in, site form rendered', true);

  for (const id of ['site', 'projects', 'about', 'ui', 'assistant', 'knowledge', 'questionnaire']) {
    await page.click(`.adm-side__item:has-text("${await page.evaluate((i) => ({ site: 'Site & SEO', projects: 'Discs & projects', about: 'About page', ui: 'Interface text', assistant: 'Chat copy', knowledge: 'Bot knowledge', questionnaire: 'Questionnaire' })[i], id)}")`);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `admin-${id}.png`) });
  }

  // Edit the tagline, save, check the file and the live gallery, then revert.
  await page.click('.adm-side__item:has-text("Site & SEO")');
  const tagline = page.getByLabel('Gallery tagline');
  const before = await tagline.inputValue();
  await tagline.fill(`${before} ADMIN-TEST`);
  ok('dirty dot shown', await page.locator('.adm-side__item[aria-current=page] .adm-dot').isVisible());
  await page.keyboard.press('Meta+s');
  await page.getByText('Saved to src/content/data/site.json').waitFor({ timeout: 5000 });
  ok('file written', JSON.parse(readFileSync(siteFile, 'utf8')).tagline.endsWith('ADMIN-TEST'));
  const site = await ctx.newPage();
  await site.goto(`${base}/`, { waitUntil: 'networkidle' });
  await site.waitForTimeout(800);
  ok('gallery shows edited tagline', (await site.textContent('.gallery__intro'))?.includes('ADMIN-TEST'));
  await site.close();

  // Validation: an invalid slug blocks the save.
  await page.click('.adm-side__item:has-text("Discs & projects")');
  await page.click('.adm-master__pick >> nth=2');
  await page.getByLabel('URL slug').fill('Bad Slug');
  await page.click('.adm-btn--primary');
  ok('invalid slug blocks save', await page.locator('.adm-status[data-kind=error]').isVisible());
  await page.screenshot({ path: path.join(OUT, 'admin-projects-error.png') });
  page.once('dialog', (d) => d.accept());
  await page.click('.adm-btn:has-text("Discard")');

  await page.click('.adm-side__item:has-text("Site & SEO")');
  await page.getByLabel('Gallery tagline').fill(before);
  await page.click('.adm-btn--primary');
  await page.getByText('Saved to src/content/data/site.json').waitFor({ timeout: 5000 });
  ok('revert restores the file byte-for-byte', readFileSync(siteFile, 'utf8') === original);

  // Prompt preview.
  await page.click('.adm-side__item:has-text("Bot knowledge")');
  await page.click('button:has-text("Show prompt")');
  await page.waitForSelector('.adm-pre');
  const prompt = await page.textContent('.adm-pre');
  ok('prompt preview', prompt.includes('Knowledge about Geetesh Ranjan') && prompt.includes('How to answer') && !prompt.includes('{first}'));
  await page.screenshot({ path: path.join(OUT, 'admin-prompt.png'), fullPage: false });

  // Site pages still render with the JSON content.
  for (const url of ['/about', '/work/gys-marketing']) {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`pageerror ${url}: ${e.message}`));
    await p.goto(`${base}${url}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(600);
    const text = await p.textContent('main');
    ok(`${url} renders`, url === '/about' ? text.includes('Experience') && text.includes('Ask about me') : text.includes('Websites') && text.includes('Visit site'));
    await p.close();
  }
  const html = await (await fetch(`${base}/`)).text();
  ok('index.html title from site.json', html.includes('<title>Geetesh Ranjan | Marketing, Systems and Products</title>'));

  ok('no page errors', !errors.length, errors.slice(0, 5).join(' | '));
} finally {
  if (readFileSync(siteFile, 'utf8') !== original) writeFileSync(siteFile, original);
  await browser.close();
  await server.close();
}
console.log(results.join('\n'));
