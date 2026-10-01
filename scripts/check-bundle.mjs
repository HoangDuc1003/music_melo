#!/usr/bin/env node
// Giữ app mở nhanh: đo dung lượng gzip của phần JS/CSS nạp ngay khi mở app (các file mà dist/index.html
// tham chiếu + modulepreload). youtubei.js, BotGuard… phải nằm ở chunk nạp sau, không tính vào đây.
// node scripts/check-bundle.mjs [distDir] [--max-js KB] [--max-css KB]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;

/** Các file JS/CSS mà index.html nạp ngay (script module, modulepreload, stylesheet). */
export function initialAssets(html) {
  const assets = { js: [], css: [] };
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const src = /\b(?:src|href)="([^"]+)"/i.exec(tag)?.[1];
    if (!src || /^(https?:)?\/\//i.test(src)) continue;
    if (/^<script/i.test(tag) && /type="module"/i.test(tag)) assets.js.push(src);
    else if (/rel="modulepreload"/i.test(tag)) assets.js.push(src);
    else if (/rel="stylesheet"/i.test(tag)) assets.css.push(src);
  }
  return assets;
}

export function gzipSize(buffer) {
  return gzipSync(buffer, { level: 9 }).length;
}

function parseArgs(argv) {
  const args = { dist: 'dist', maxJs: 170, maxCss: 12 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max-js') args.maxJs = Number(argv[++i]);
    else if (argv[i] === '--max-css') args.maxCss = Number(argv[++i]);
    else args.dist = argv[i];
  }
  if (!(args.maxJs > 0) || !(args.maxCss > 0)) throw new Error('--max-js / --max-css phải là số KB > 0');
  return args;
}

function main() {
  const { dist, maxJs, maxCss } = parseArgs(process.argv.slice(2));
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const { js, css } = initialAssets(html);
  if (!js.length) throw new Error('Không tìm thấy file JS nào trong index.html');
  const measure = (files) =>
    files.map((file) => {
      const buffer = readFileSync(join(dist, file.replace(/^\//, '')));
      return { file, raw: buffer.length, gzip: gzipSize(buffer) };
    });
  const report = { js: measure(js), css: measure(css) };
  const total = (rows) => rows.reduce((sum, r) => sum + r.gzip, 0);
  for (const row of [...report.js, ...report.css]) {
    console.log(`${row.file}: ${(row.raw / KB).toFixed(1)} KB, gzip ${(row.gzip / KB).toFixed(1)} KB`);
  }
  const jsKb = total(report.js) / KB;
  const cssKb = total(report.css) / KB;
  console.log(`Nạp ngay: JS ${jsKb.toFixed(1)}/${maxJs} KB gzip, CSS ${cssKb.toFixed(1)}/${maxCss} KB gzip`);
  const errors = [];
  if (jsKb > maxJs) errors.push(`JS nạp ngay ${jsKb.toFixed(1)} KB gzip > ${maxJs} KB. Thư viện lớn hãy nạp bằng import() động.`);
  if (cssKb > maxCss) errors.push(`CSS ${cssKb.toFixed(1)} KB gzip > ${maxCss} KB.`);
  if (errors.length) throw new Error(errors.join(' '));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
