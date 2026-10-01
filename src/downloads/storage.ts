// Nơi lưu bài đã tải.
// - iPhone: Library/NoCloud/music/<id>.m4a (+ .jpg ảnh bìa, .json thông tin bài) — không bị đẩy lên iCloud.
//   Không bao giờ lưu đường dẫn tuyệt đối: thư mục app đổi UUID mỗi lần cài bản mới, nên luôn tính lại lúc chạy.
// - Trình duyệt (chạy thử trên PC): Blob trong IndexedDB (bảng `blobs`).
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import { db } from '@/lib/db';
import { log } from '@/lib/log';
import { isNative } from '@/lib/platform';
import { appFetch } from '@/youtube/http';
import type { Track } from '@/youtube/types';

export interface DownloadProgress {
  bytes: number;
  total: number;
}

export interface DownloadRequest {
  id: string;
  url: string;
  headers?: Record<string, string>;
  /** byte, nếu biết trước (để kiểm tra file tải trọn) */
  expectedBytes?: number;
  onProgress: (p: DownloadProgress) => void;
}

export interface SidecarInfo {
  track: Track;
  downloadedAt: number;
  bytes: number;
  mimeType?: string;
}

export interface DownloadStorage {
  /** Tải file nhạc; trả về số byte đã lưu. */
  saveAudio(request: DownloadRequest): Promise<number>;
  /** Ảnh bìa để xem offline (bỏ qua nếu lỗi). */
  saveArtwork(id: string, url: string): Promise<boolean>;
  saveSidecar(id: string, info: SidecarInfo): Promise<void>;
  remove(id: string): Promise<void>;
  /** Link cho trình phát (file:// trên iPhone, blob: trên trình duyệt); undefined nếu chưa có file. */
  audioUrl(id: string): Promise<string | undefined>;
  /** Link ảnh bìa đã lưu dùng được trong WebView. */
  artworkUrl(id: string): Promise<string | undefined>;
  /** Ảnh bìa dùng cho màn hình khoá (native đọc file:// trực tiếp). */
  artworkFileUrl(id: string): Promise<string | undefined>;
  /** Thông tin các bài có file trên máy (để dựng lại thư viện nếu dữ liệu app bị mất). */
  listSidecars(): Promise<SidecarInfo[]>;
}

/** videoId của YouTube: đúng 11 ký tự [A-Za-z0-9_-]. Kiểm tra trước khi dùng làm tên file. */
export const SAFE_ID = /^[\w-]{11}$/;

export function assertSafeId(id: string) {
  if (!SAFE_ID.test(id)) throw new Error(`id không hợp lệ: ${id.slice(0, 20)}`);
}

/** YouTube treo nếu GET cả file không có range → thêm &range=0-<n-1> (xem CLAUDE.md). */
export function withRange(url: string, contentLength: number | undefined): { url: string; headers: Record<string, string> } {
  if (contentLength && contentLength > 0) {
    const u = new URL(url);
    u.searchParams.set('range', `0-${contentLength - 1}`);
    return { url: u.toString(), headers: {} };
  }
  return { url, headers: { Range: 'bytes=0-' } };
}

// ---------- iPhone ----------

const DIR = Directory.LibraryNoCloud;
const FOLDER = 'music';

class NativeStorage implements DownloadStorage {
  private base?: Promise<string>;
  private progressHandlers = new Map<string, (p: DownloadProgress) => void>();
  private listening?: Promise<unknown>;

  private folderUri(): Promise<string> {
    this.base ??= (async () => {
      await Filesystem.mkdir({ path: FOLDER, directory: DIR, recursive: true }).catch(() => undefined);
      const { uri } = await Filesystem.getUri({ path: FOLDER, directory: DIR });
      return uri.replace(/\/$/, '');
    })();
    return this.base;
  }

  private listen() {
    this.listening ??= FileTransfer.addListener('progress', (p) => {
      if (p.type !== 'download') return;
      this.progressHandlers.get(p.url)?.({ bytes: p.bytes, total: p.lengthComputable ? p.contentLength : 0 });
    });
    return this.listening;
  }

  private async exists(path: string): Promise<number | undefined> {
    try {
      const info = await Filesystem.stat({ path, directory: DIR });
      return info.type === 'file' ? info.size : undefined;
    } catch {
      return undefined;
    }
  }

  async saveAudio({ id, url, headers, expectedBytes, onProgress }: DownloadRequest): Promise<number> {
    assertSafeId(id);
    await this.listen();
    const base = await this.folderUri();
    const part = `${FOLDER}/${id}.m4a.part`;
    this.progressHandlers.set(url, onProgress);
    try {
      await FileTransfer.downloadFile({
        url,
        path: `${base}/${id}.m4a.part`,
        headers,
        progress: true,
        connectTimeout: 30_000,
        readTimeout: 60_000,
        // Link googlevideo đã được mã hoá sẵn; mã hoá lần nữa sẽ làm hỏng chữ ký.
        shouldEncodeUrlParams: false
      });
    } finally {
      this.progressHandlers.delete(url);
    }
    const size = (await this.exists(part)) ?? 0;
    if (size < 32 * 1024 || (expectedBytes && size < expectedBytes * 0.98)) {
      await Filesystem.deleteFile({ path: part, directory: DIR }).catch(() => undefined);
      throw new Error(`Tải chưa trọn (${size}/${expectedBytes ?? '?'} byte)`);
    }
    await Filesystem.deleteFile({ path: `${FOLDER}/${id}.m4a`, directory: DIR }).catch(() => undefined);
    await Filesystem.rename({ from: part, to: `${FOLDER}/${id}.m4a`, directory: DIR, toDirectory: DIR });
    return size;
  }

  async saveArtwork(id: string, url: string): Promise<boolean> {
    assertSafeId(id);
    if (!/^https:\/\//.test(url)) return false;
    try {
      const base = await this.folderUri();
      await FileTransfer.downloadFile({ url, path: `${base}/${id}.jpg`, connectTimeout: 20_000, readTimeout: 30_000 });
      return true;
    } catch (err) {
      log.warn('download', `ảnh bìa ${id} lỗi:`, err);
      return false;
    }
  }

  async saveSidecar(id: string, info: SidecarInfo): Promise<void> {
    assertSafeId(id);
    await this.folderUri();
    await Filesystem.writeFile({ path: `${FOLDER}/${id}.json`, directory: DIR, data: JSON.stringify(info), encoding: Encoding.UTF8 });
  }

  async remove(id: string): Promise<void> {
    assertSafeId(id);
    for (const ext of ['m4a', 'm4a.part', 'jpg', 'json']) {
      await Filesystem.deleteFile({ path: `${FOLDER}/${id}.${ext}`, directory: DIR }).catch(() => undefined);
    }
  }

  async audioUrl(id: string): Promise<string | undefined> {
    if (!SAFE_ID.test(id)) return undefined;
    return `${await this.folderUri()}/${id}.m4a`;
  }

  async artworkFileUrl(id: string): Promise<string | undefined> {
    if (!SAFE_ID.test(id)) return undefined;
    return `${await this.folderUri()}/${id}.jpg`;
  }

  async artworkUrl(id: string): Promise<string | undefined> {
    const file = await this.artworkFileUrl(id);
    return file ? Capacitor.convertFileSrc(file) : undefined;
  }

  async listSidecars(): Promise<SidecarInfo[]> {
    await this.folderUri();
    const { files } = await Filesystem.readdir({ path: FOLDER, directory: DIR });
    const names = new Set(files.map((f) => f.name));
    const result: SidecarInfo[] = [];
    for (const name of names) {
      const id = name.replace(/\.json$/, '');
      if (!name.endsWith('.json') || !SAFE_ID.test(id) || !names.has(`${id}.m4a`)) continue;
      try {
        const { data } = await Filesystem.readFile({ path: `${FOLDER}/${name}`, directory: DIR, encoding: Encoding.UTF8 });
        const info = JSON.parse(String(data)) as SidecarInfo;
        if (info?.track?.id === id) result.push(info);
      } catch (err) {
        log.warn('download', `đọc ${name} lỗi:`, err);
      }
    }
    return result;
  }
}

// ---------- Trình duyệt (chạy thử) ----------

async function fetchBlob(url: string, headers: Record<string, string> | undefined, onProgress?: (p: DownloadProgress) => void): Promise<Blob> {
  const res = url.startsWith('blob:') || url.startsWith('data:') ? await fetch(url) : await appFetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onProgress) return res.blob();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.length;
    onProgress({ bytes, total });
  }
  return new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? 'audio/mp4' });
}

class WebStorage implements DownloadStorage {
  private urls = new Map<string, string>();

  async saveAudio({ id, url, headers, onProgress }: DownloadRequest): Promise<number> {
    assertSafeId(id);
    const audio = await fetchBlob(url, headers, onProgress);
    const existing = await db.blobs.get(id);
    await db.blobs.put({ id, audio, artwork: existing?.artwork });
    this.revoke(id);
    return audio.size;
  }

  async saveArtwork(id: string, url: string): Promise<boolean> {
    try {
      const artwork = await fetchBlob(url, undefined);
      await db.blobs.update(id, { artwork });
      return true;
    } catch {
      return false;
    }
  }

  async saveSidecar(): Promise<void> {
    // Thông tin bài đã nằm trong IndexedDB.
  }

  private revoke(id: string) {
    for (const key of [id, `${id}:art`]) {
      const url = this.urls.get(key);
      if (url) URL.revokeObjectURL(url);
      this.urls.delete(key);
    }
  }

  async remove(id: string): Promise<void> {
    this.revoke(id);
    await db.blobs.delete(id);
  }

  async audioUrl(id: string): Promise<string | undefined> {
    if (this.urls.has(id)) return this.urls.get(id);
    const row = await db.blobs.get(id);
    if (!row) return undefined;
    const url = URL.createObjectURL(row.audio);
    this.urls.set(id, url);
    return url;
  }

  async artworkUrl(id: string): Promise<string | undefined> {
    const key = `${id}:art`;
    if (this.urls.has(key)) return this.urls.get(key);
    const row = await db.blobs.get(id);
    if (!row?.artwork) return undefined;
    const url = URL.createObjectURL(row.artwork);
    this.urls.set(key, url);
    return url;
  }

  artworkFileUrl(id: string): Promise<string | undefined> {
    return this.artworkUrl(id);
  }

  async listSidecars(): Promise<SidecarInfo[]> {
    return [];
  }
}

let storage: DownloadStorage | undefined;

export function getStorage(): DownloadStorage {
  storage ??= isNative ? new NativeStorage() : new WebStorage();
  return storage;
}

/** Chỉ dùng trong test. */
export function setStorageForTests(value: DownloadStorage | undefined) {
  storage = value;
}
