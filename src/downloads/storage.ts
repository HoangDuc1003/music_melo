// Nơi lưu bài đã tải.
// - iPhone: Library/NoCloud/music/<id>.m4a (+ .jpg ảnh bìa, .json thông tin bài) — không bị đẩy lên iCloud.
//   Không bao giờ lưu đường dẫn tuyệt đối: thư mục app đổi UUID mỗi lần cài bản mới, nên luôn tính lại lúc chạy.
// - Trình duyệt (chạy thử trên PC): Blob trong IndexedDB (bảng `blobs`).
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import { MeloPlayer, type StreamRefresh } from 'capacitor-melo-player';
import { memoAsync } from '@/lib/async';
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
  /** iPhone: cách native tự xin link mới khi link hết lượt giữa chừng (YouTube: link không PO token chỉ cho ~1 MiB). */
  refresh?: StreamRefresh;
  /** Link mới (lấy bằng JS) khi native không tự đổi được link. */
  refreshUrl?: () => Promise<Pick<DownloadRequest, 'url' | 'refresh'>>;
}

/** Số lần đổi link tối đa cho một bài (mỗi link ~1 MiB → đủ cho bài ~20 phút). */
const MAX_URL_ROTATIONS = 20;

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
  /** Thông tin các bài có file trên máy nhưng không có trong `known` (dựng lại thư viện nếu dữ liệu app bị mất). */
  listSidecars(known: ReadonlySet<string>): Promise<SidecarInfo[]>;
  /** Lưu file nhạc người dùng tự chọn (bản web). Trả về số byte. */
  saveFile(id: string, audio: Blob, artwork?: Blob): Promise<number>;
}

/**
 * id bài dùng làm tên file: chỉ [A-Za-z0-9_-] (videoId YouTube 11 ký tự; bản web: "jm-123…", "lf-…").
 * Kiểm tra trước khi ghép vào đường dẫn.
 */
export const SAFE_ID = /^[\w-]{3,64}$/;

function assertSafeId(id: string) {
  if (!SAFE_ID.test(id)) throw new Error(`id không hợp lệ: ${id.slice(0, 20)}`);
}

/**
 * Tải bằng fetch (trình duyệt, chạy thử trên PC qua proxy dev): YouTube treo nếu GET cả file không có range → thêm
 * &range=0-<n-1> (xem CLAUDE.md). Nguồn khác giữ nguyên. iPhone thì plugin tự tải từng đoạn.
 */
export function withRange(url: string, contentLength: number | undefined): { url: string; headers: Record<string, string> } {
  if (!/(^|\.)googlevideo\.com$/.test(new URL(url).hostname)) return { url, headers: {} };
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
  /** Tiến độ tải theo id bài (sự kiện "downloadProgress" của plugin). */
  private progressHandlers = new Map<string, (p: DownloadProgress) => void>();
  private listening?: Promise<unknown>;

  /** Đường dẫn thư mục nhạc (tạo nếu chưa có); lỗi thì lần sau thử lại. */
  private folderUri = memoAsync(async () => {
    await Filesystem.mkdir({ path: FOLDER, directory: DIR, recursive: true }).catch(() => undefined);
    const { uri } = await Filesystem.getUri({ path: FOLDER, directory: DIR });
    return uri.replace(/\/$/, '');
  });

  private listen() {
    this.listening ??= MeloPlayer.addListener('downloadProgress', (p) => this.progressHandlers.get(p.id)?.({ bytes: p.bytes, total: p.total }));
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

  async saveAudio({ id, url, headers, expectedBytes, onProgress, refresh, refreshUrl }: DownloadRequest): Promise<number> {
    assertSafeId(id);
    await this.listen();
    const base = await this.folderUri();
    const part = `${FOLDER}/${id}.m4a.part`;
    this.progressHandlers.set(id, onProgress);
    try {
      // Plugin tải từng đoạn ≤ 1 MiB bằng URLSession và tự đổi link hết lượt nếu có `refresh`. Không tự đổi được
      // (403 sau khi đã tải được một phần): lấy link mới bằng JS rồi tải tiếp từ chỗ dừng.
      let link: Pick<DownloadRequest, 'url' | 'refresh'> = { url, refresh };
      let offset = 0;
      for (let rotation = 0; ; rotation++) {
        try {
          const result = await MeloPlayer.downloadFile({ id, url: link.url, path: `${base}/${id}.m4a.part`, headers, offset, refresh: link.refresh });
          if (result.rotations) log.info('download', `${id}: tự đổi link ${result.rotations} lần`);
          break;
        } catch (err) {
          const data = (err as { data?: { httpStatus?: number; bytes?: number } }).data;
          const have = Number(data?.bytes ?? 0);
          // Đổi link khi link đã cho thêm dữ liệu; lần đầu thì đổi cả khi chưa được byte nào (link lấy từ bộ nhớ có thể
          // đã hết lượt lúc phát bài này). Link mới bị từ chối ngay thì thôi.
          const progressed = have > offset || rotation === 0;
          if (!refreshUrl || data?.httpStatus !== 403 || !progressed || rotation >= MAX_URL_ROTATIONS) throw err;
          log.info('download', `${id}: link hết lượt ở byte ${have}, lấy link mới (lần ${rotation + 1})`);
          offset = have;
          link = await refreshUrl();
        }
      }
    } finally {
      this.progressHandlers.delete(id);
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

  async saveFile(): Promise<number> {
    throw new Error('Thêm nhạc từ máy chỉ có ở bản web');
  }

  async listSidecars(known: ReadonlySet<string>): Promise<SidecarInfo[]> {
    await this.folderUri();
    const { files } = await Filesystem.readdir({ path: FOLDER, directory: DIR });
    const names = new Set(files.map((f) => f.name));
    const result: SidecarInfo[] = [];
    for (const name of names) {
      const id = name.replace(/\.json$/, '');
      // Chỉ đọc file .json của bài chưa có trong DB (mỗi lần đọc là một lượt gọi native).
      if (!name.endsWith('.json') || known.has(id) || !SAFE_ID.test(id) || !names.has(`${id}.m4a`)) continue;
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
  let res: Response;
  try {
    res = url.startsWith('blob:') || url.startsWith('data:') ? await fetch(url) : await appFetch(url, { headers });
  } catch {
    // Trình duyệt chỉ báo "Load failed" / "Failed to fetch": mất mạng hoặc máy chủ không cho trang web tải (CORS).
    throw Object.assign(new Error('Không tải được file (mất mạng, hoặc nguồn nhạc không cho tải về)'), { reason: 'network' });
  }
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

  async saveAudio({ id, url, headers, expectedBytes, onProgress }: DownloadRequest): Promise<number> {
    assertSafeId(id);
    const ranged = withRange(url, expectedBytes);
    const audio = await fetchBlob(ranged.url, { ...headers, ...ranged.headers }, onProgress);
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

  async saveFile(id: string, audio: Blob, artwork?: Blob): Promise<number> {
    assertSafeId(id);
    await db.blobs.put({ id, audio, artwork });
    this.revoke(id);
    return audio.size;
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
