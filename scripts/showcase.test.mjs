import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

for (const path of ['pocket-alternatifi/index.html', 'en/pocket-alternative/index.html']) {
  test(`${path}: complete setup, single-column hero and honest import copy`, () => {
    const html = readFileSync(new URL(`../showcase/${path}`, import.meta.url), 'utf8');
    assert.match(html, /class="hero hero-text"/);
    assert.match(html, /git clone[^\n]+\r?\ncd readflow\r?\npnpm install/);
    assert.doesNotMatch(html, /makaleler, vurgular ve notlar|articles, highlights and notes/);
    for (const id of [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map(m => m[1])) {
      assert.ok(html.includes(`id="${id}"`), `Missing heading ${id}`);
    }
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    assert.equal(schema['@graph'][1]['@type'], 'FAQPage');
  });
}

for (const path of ['index.html', 'en/index.html']) {
  test(`${path}: responsive light/dark hero images`, () => {
    const html = readFileSync(new URL(`../showcase/${path}`, import.meta.url), 'utf8');
    const assets = path.startsWith('en/') ? 'assets/en' : 'assets';
    assert.ok(html.includes(`/${assets}/doc-light-800.webp?v=`), 'Missing versioned light mobile source');
    assert.ok(html.includes(`/${assets}/doc-dark-800.webp?v=`), 'Missing versioned dark mobile source');
    for (const theme of ['light', 'dark']) {
      assert.ok(readFileSync(new URL(`../showcase/${assets}/doc-${theme}-800.webp`, import.meta.url)).length > 0);
    }
    assert.match(html, /src="\/theme.js\?v=20261024"/);
    const languageTarget = path.startsWith('en/') ? '/' : '/en/';
    assert.ok(html.includes(`href="${languageTarget}?v=20261024" hreflang=`), 'Language switch must bypass stale HTML');
    assert.match(html, /data-theme-toggle/);
    assert.match(html, /script-src 'self'/);
    for (const [, asset] of html.matchAll(/(?:src|srcset)="(\/assets\/[^" ,]+)/g)) {
      assert.ok(readFileSync(new URL(`../showcase${asset.split('?')[0]}`, import.meta.url)).length > 0, asset);
      assert.match(asset, /\?v=[a-f0-9]{10}$/);
      if (path.startsWith('en/')) assert.match(asset, /^\/assets\/en\//);
    }
  });
}

test('theme choice overrides the system, switches images and survives reload', () => {
  const script = readFileSync(new URL('../showcase/theme.js', import.meta.url), 'utf8');
  const saved = new Map([['readflow-showcase-theme', 'light']]);
  function mount() {
    const root = { lang: 'en', dataset: {} };
    const source = { media: '(prefers-color-scheme: dark)' };
    const button = { hidden: true, textContent: '', setAttribute() {}, addEventListener(_, fn) { this.click = fn; } };
    runInNewContext(script, {
      document: {
        documentElement: root,
        querySelectorAll: selector => selector.startsWith('picture') ? [source] : [button],
        addEventListener: (_, fn) => fn(),
      },
      window: { matchMedia: () => ({ matches: true, addEventListener() {} }) },
      localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    });
    return { root, source, button };
  }
  const first = mount();
  assert.equal(first.root.dataset.theme, 'light');
  assert.equal(first.source.media, 'not all');
  assert.equal(first.button.textContent, 'Dark theme');
  assert.equal(first.button.hidden, false);
  first.button.click();
  assert.equal(first.source.media, 'all');
  assert.equal(first.button.textContent, 'Light theme');
  assert.equal(mount().root.dataset.theme, 'dark');
});
