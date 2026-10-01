import { describe, expect, it } from 'vitest';
import { installPage, manifestPlist, sourceJson } from './release-meta.mjs';

const base = {
  version: '0.2.12',
  build: '12',
  ipaUrl: 'https://github.com/o/r/releases/download/ios-latest/Melo.ipa',
  ipaSize: '1577449',
  iconUrl: 'https://github.com/o/r/releases/download/ios-latest/icon.png',
  sourceUrl: 'https://github.com/o/r/releases/download/ios-latest/source.json',
  date: '2026-10-01T16:00:00Z'
};

describe('release-meta', () => {
  it('source.json đúng định dạng SideStore/AltStore', () => {
    const source = sourceJson(base);
    const app = source.apps[0];
    expect(app.bundleIdentifier).toBe('com.melo.music');
    expect(app.versions[0]).toMatchObject({ version: '0.2.12', buildVersion: '12', size: 1577449, downloadURL: base.ipaUrl, minOSVersion: '15.0' });
    expect(JSON.parse(JSON.stringify(source))).toEqual(source);
  });

  it('manifest.plist cho itms-services có đủ mục và được escape', () => {
    const xml = manifestPlist({ ...base, adhocIpaUrl: 'https://x.github.io/r/Melo-adhoc.ipa?a=1&b=2' });
    expect(xml).toContain('<string>software-package</string>');
    expect(xml).toContain('https://x.github.io/r/Melo-adhoc.ipa?a=1&amp;b=2');
    expect(xml).toContain('<string>com.melo.music</string>');
    expect(xml).toContain('<string>0.2.12</string>');
  });

  it('trang cài đặt: có nút 1 chạm khi có manifest, không chèn được HTML', () => {
    const withAdhoc = installPage({ ...base, sha256: 'a'.repeat(64), manifestUrl: 'https://x.github.io/r/manifest.plist' });
    expect(withAdhoc).toContain('itms-services://?action=download-manifest&amp;url=https%3A%2F%2Fx.github.io%2Fr%2Fmanifest.plist');
    expect(withAdhoc).toContain('sidestore://source?url=');
    const plain = installPage({ ...base, version: '<script>alert(1)</script>' });
    expect(plain).not.toContain('itms-services');
    expect(plain).not.toContain('<script>alert');
    expect(plain).toContain('&lt;script&gt;');
  });
});
