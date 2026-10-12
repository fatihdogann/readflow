import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

for (const path of ['pocket-alternatifi/index.html', 'en/pocket-alternative/index.html']) {
  test(`${path}: complete setup, single-column hero and honest import copy`, () => {
    const html = readFileSync(new URL(`../showcase/${path}`, import.meta.url), 'utf8');
    assert.match(html, /class="hero hero-text"/);
    assert.match(html, /git clone[^\n]+\ncd readflow\npnpm install/);
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
    assert.ok(html.includes('/assets/doc-light-800.webp 800w'), 'Missing light mobile source');
    assert.ok(html.includes('/assets/doc-dark-800.webp 800w'), 'Missing dark mobile source');
    for (const theme of ['light', 'dark']) {
      assert.ok(readFileSync(new URL(`../showcase/assets/doc-${theme}-800.webp`, import.meta.url)).length > 0);
    }
  });
}
