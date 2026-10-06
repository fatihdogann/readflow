// Run from the repository root: node scripts/build-showcase-cards.mjs
// To use an installed Chrome: PLAYWRIGHT_CHANNEL=chrome node scripts/build-showcase-cards.mjs
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const logo = Buffer.from(await readFile(new URL('../showcase/favicon.svg', import.meta.url))).toString('base64');
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const [lang, title, highlight, description, label] of [
    ['tr', 'Okudukların,', 'elinin altında', 'Oku, vurgula, kendi agent’ınla özetle.', 'Kendi bilgisayarında bir okuma alanı'],
    ['en', 'Your reading,', 'within reach', 'Read, highlight, summarize with your own agent.', 'A reading space on your own computer'],
  ]) {
    await page.setContent(`<!doctype html><html lang="${lang}"><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body { margin: 0; width: 1200px; height: 630px; padding: 56px 72px; background: #f7f5f2; color: #41483a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      header { display: flex; align-items: center; gap: 16px; font-size: 32px; font-weight: 650; }
      img { width: 52px; height: 52px; }
      h1 { margin: 52px 0 24px; font: 500 80px/1.12 Charter, 'Iowan Old Style', Georgia, serif; letter-spacing: -2px; }
      mark { color: inherit; background: #f3df9a; padding: 0 8px; }
      p { margin: 0; color: #57534e; font-size: 26px; line-height: 1.6; }
      footer { display: flex; justify-content: space-between; align-items: center; margin-top: 48px; padding-top: 20px; border-top: 1px solid #dedad4; font-size: 17px; color: #57534e; }
    </style><header><img src="data:image/svg+xml;base64,${logo}" alt="">Readflow</header>
    <h1>${title}<br><mark>${highlight}</mark>.</h1><p>${description}</p>
    <footer><span>${label}</span><span>readflow.mehmetfatihdogan.com.tr</span></footer></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: new URL(`../showcase/assets/og-${lang}.png`, import.meta.url).pathname });
    console.log(`showcase/assets/og-${lang}.png — 1200×630`);
  }
} finally {
  await browser.close();
}
