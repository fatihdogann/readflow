// Run from the repository root: node scripts/build-showcase-cards.mjs
// To use an installed Chrome: PLAYWRIGHT_CHANNEL=chrome node scripts/build-showcase-cards.mjs
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const asset = async (path, type) => `data:${type};base64,${(await readFile(new URL(path, import.meta.url))).toString('base64')}`;
const logo = await asset('../showcase/favicon.svg', 'image/svg+xml');
const shot = await asset('../showcase/assets/doc-light-1600.webp', 'image/webp');
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  // Large type on purpose: chat apps show this card at roughly a quarter of its size.
  for (const [lang, title, highlight, description] of [
    ['tr', 'Oku. Arşivle.', 'Özetle.', 'Makale ve PDF arşivin, kendi bilgisayarında.'],
    ['en', 'Read. Archive.', 'Summarize.', 'Your articles and PDFs, on your own computer.'],
  ]) {
    await page.setContent(`<!doctype html><html lang="${lang}"><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; }
      body { position: relative; width: 1200px; height: 630px; overflow: hidden; background: #f7f5f2; color: #2f352a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      .copy { position: absolute; left: 64px; top: 56px; width: 560px; }
      header { display: flex; align-items: center; gap: 18px; font-size: 46px; font-weight: 700; letter-spacing: -.5px; }
      header img { width: 72px; height: 72px; }
      h1 { margin-top: 56px; font: 600 84px/1.06 Charter, 'Iowan Old Style', Georgia, serif; letter-spacing: -2px; }
      mark { color: inherit; background: #f3df9a; padding: 0 10px; }
      p { margin-top: 26px; color: #4a4640; font-size: 28px; line-height: 1.4; }
      footer { position: absolute; left: 64px; bottom: 46px; font-size: 25px; font-weight: 600; color: #41483a; }
      /* Zoomed into the reading pane so the preview stays legible at chat-preview size. */
      figure { position: absolute; left: 660px; top: 64px; width: 600px; height: 470px; border: 1px solid #dedad4; border-radius: 14px; overflow: hidden; background: #fff; box-shadow: 0 30px 70px -24px #4a40306b; }
      figure img { position: absolute; left: -250px; top: -12px; width: 1150px; }
    </style><div class="copy"><header><img src="${logo}" alt="">Readflow</header>
    <h1>${title}<br><mark>${highlight}</mark></h1><p>${description}</p></div>
    <footer>readflow.mehmetfatihdogan.com.tr</footer><figure><img src="${shot}" alt=""></figure></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: new URL(`../showcase/assets/og-${lang}.png`, import.meta.url).pathname });
    console.log(`showcase/assets/og-${lang}.png — 1200×630`);
  }
} finally {
  await browser.close();
}
