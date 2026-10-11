#!/usr/bin/env node
// showcase/sitemap.xml'i sayfa listesinden yeniden yazar (TR + EN, hreflang alternatifiyle).
// lastmod = kaynak dosyanın son commit tarihi (git log -1 --format=%cs), yoksa bugün.
// Sayfa değişince: node scripts/sitemap.mjs
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const SITE = 'https://readflow.mehmetfatihdogan.com.tr'

// URL → kaynak dosya. loc, sayfadaki canonical ile birebir aynı yazımda olmalı.
const pages = [
  {
    loc: `${SITE}/`,
    source: 'showcase/index.html',
    alternates: [
      { hreflang: 'tr', href: `${SITE}/` },
      { hreflang: 'en', href: `${SITE}/en/` },
    ],
  },
  {
    loc: `${SITE}/en/`,
    source: 'showcase/en/index.html',
    alternates: [
      { hreflang: 'tr', href: `${SITE}/` },
      { hreflang: 'en', href: `${SITE}/en/` },
    ],
  },
]

const AMP = '&'
const esc = (s) =>
  s
    .replace(/&/g, AMP + 'amp;')
    .replace(/</g, AMP + 'lt;')
    .replace(/>/g, AMP + 'gt;')
    .replace(/"/g, AMP + 'quot;')

function lastmod(file) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: root, encoding: 'utf8' }).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out
  } catch {}
  return new Date().toISOString().slice(0, 10)
}

const hasAlternates = pages.some((p) => Array.isArray(p.alternates) && p.alternates.length > 0)
const lines = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${hasAlternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ''}>`,
]
for (const { loc, source, alternates } of pages) {
  lines.push('  <url>', `    <loc>${esc(loc)}</loc>`)
  for (const a of alternates ?? []) {
    lines.push(`    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${esc(a.href)}"/>`)
  }
  lines.push(`    <lastmod>${lastmod(source)}</lastmod>`, '  </url>')
}
lines.push('</urlset>', '')

writeFileSync(`${root}/showcase/sitemap.xml`, lines.join('\n'))
console.log(`showcase/sitemap.xml güncellendi: ${pages.length} URL`)
