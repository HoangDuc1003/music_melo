import { describe, expect, it } from 'vitest';
import { gzipSize, initialAssets } from './check-bundle.mjs';

describe('check-bundle', () => {
  it('chỉ lấy file nạp ngay: script module, modulepreload, stylesheet', () => {
    const html = `<head>
      <script type="module" crossorigin src="/assets/index-a.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/vendor-b.js">
      <link rel="stylesheet" crossorigin href="/assets/index-c.css">
      <link rel="icon" type="image/svg+xml" href="/icon.svg" />
      <script src="https://cdn.example/x.js"></script>
    </head>`;
    expect(initialAssets(html)).toEqual({ js: ['/assets/index-a.js', '/assets/vendor-b.js'], css: ['/assets/index-c.css'] });
  });

  it('đo gzip', () => {
    const text = Buffer.from('a'.repeat(10_000));
    expect(gzipSize(text)).toBeLessThan(200);
  });
});
