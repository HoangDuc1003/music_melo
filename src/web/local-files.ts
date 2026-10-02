// Thêm nhạc của chính người dùng (chọn từ app Tệp / iCloud Drive) vào Melo bản web.
// File được lưu trong trình duyệt (IndexedDB) như bài đã tải: nghe offline, xếp vào playlist, thích…
import { addLocalFiles, type LocalFile } from '@/downloads/manager';
import { log } from '@/lib/log';
import type { Track } from '@/youtube/types';
import { requestPersistentStorage } from './pwa';
import { readTags, tagsFromFileName } from './tags';

const AUDIO_EXTENSION = /\.(mp3|m4a|aac|mp4|wav|flac|ogg|oga|opus|aiff?|caf)$/i;
/** Ghi xuống IndexedDB theo từng nhóm (đỡ tốn bộ nhớ khi chọn hàng trăm file). */
const BATCH = 10;

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXTENSION.test(file.name);
}

/** id ổn định theo tên + dung lượng + ngày sửa: chọn lại đúng file đó thì không thêm trùng. */
async function localId(file: File): Promise<string> {
  const key = new TextEncoder().encode(`${file.name}|${file.size}|${file.lastModified}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', key));
  return `lf-${[...digest.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Thời lượng (giây) đọc bằng thẻ <audio>; 0 nếu trình duyệt không đọc được định dạng này. */
export function audioDuration(file: Blob, timeoutMs = 8000): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const done = (seconds: number) => {
      clearTimeout(timer);
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0);
    };
    const timer = setTimeout(() => done(0), timeoutMs);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}

export async function toLocalFile(file: File, duration = audioDuration): Promise<LocalFile> {
  const [id, tags, seconds] = await Promise.all([localId(file), readTags(file), duration(file)]);
  const fromName = tagsFromFileName(file.name);
  const artist = tags.artist ?? fromName.artist;
  const track: Track = {
    id,
    title: tags.title ?? fromName.title,
    artists: artist ? [{ name: artist }] : [],
    album: tags.album ? { name: tags.album } : undefined,
    duration: seconds,
    thumbnail: ''
  };
  return { track, audio: file, artwork: tags.picture };
}

export interface ImportResult {
  added: number;
  /** file không phải nhạc, hoặc đã thêm trước đó */
  skipped: number;
}

export async function importAudioFiles(files: File[], options: { duration?: (file: Blob) => Promise<number> } = {}): Promise<ImportResult> {
  const audio = files.filter(isAudioFile);
  let added = 0;
  for (let i = 0; i < audio.length; i += BATCH) {
    const batch: LocalFile[] = [];
    for (const file of audio.slice(i, i + BATCH)) {
      try {
        batch.push(await toLocalFile(file, options.duration));
      } catch (err) {
        log.warn('import', `bỏ qua ${file.name}:`, err);
      }
    }
    added += await addLocalFiles(batch);
  }
  if (added) void requestPersistentStorage();
  return { added, skipped: files.length - added };
}
