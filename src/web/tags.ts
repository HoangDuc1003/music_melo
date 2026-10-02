// Đọc tên bài, nghệ sĩ, album, ảnh bìa trong file nhạc: ID3v2 (MP3) và thẻ iTunes (M4A/AAC).
// Viết tay phần nhỏ cần dùng thay cho thư viện lớn; file không có thẻ thì lấy từ tên file ("Nghệ sĩ - Tên bài.mp3").

export interface AudioTags {
  title?: string;
  artist?: string;
  album?: string;
  picture?: Blob;
}

/** Không đọc quá chừng này byte thẻ (ảnh bìa lớn nhất thường vài trăm KB). */
const MAX_TAG_BYTES = 8 * 1024 * 1024;

export async function readTags(file: Blob): Promise<AudioTags> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  try {
    if (latin1(head.subarray(0, 3)) === 'ID3') return await readId3(file, head);
    if (latin1(head.subarray(4, 8)) === 'ftyp') return await readMp4(file);
  } catch {
    // Thẻ hỏng: dùng tên file.
  }
  return {};
}

/** "Sơn Tùng M-TP - Lạc Trôi.mp3" → nghệ sĩ + tên bài; "01. Lạc Trôi.mp3" → bỏ số thứ tự. */
export function tagsFromFileName(name: string): { title: string; artist?: string } {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const withoutNumber = base.replace(/^\d{1,3}\s*[-.)]\s*/, '');
  const dash = withoutNumber.indexOf(' - ');
  if (dash > 0) return { artist: withoutNumber.slice(0, dash).trim(), title: withoutNumber.slice(dash + 3).trim() || base };
  return { title: withoutNumber || base || name };
}

// ---------- ID3v2 (2.2, 2.3, 2.4) ----------

const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes);
const syncsafe = (b: Uint8Array, o: number) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const uint32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** Bỏ "unsynchronisation": mỗi cặp FF 00 trở lại thành FF. */
function removeUnsync(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    out.push(bytes[i]);
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return Uint8Array.from(out);
}

/** Giải mã chuỗi theo kiểu mã hoá của ID3: 0 Latin-1, 1 UTF-16 có BOM, 2 UTF-16BE, 3 UTF-8. */
function decode(bytes: Uint8Array, encoding: number): string {
  let label = 'utf-8';
  if (encoding === 0) return latin1(bytes);
  if (encoding === 1) label = bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-16le';
  if (encoding === 2) label = 'utf-16be';
  return new TextDecoder(label).decode(bytes);
}

/** Khung chữ: lấy giá trị đầu tiên (ID3v2.4 có thể ghi nhiều giá trị cách nhau bởi ký tự 0). */
function textFrame(frame: Uint8Array): string | undefined {
  const value = decode(frame.subarray(1), frame[0]).split('\0')[0].trim();
  return value || undefined;
}

/** Vị trí ngay sau chuỗi kết thúc bằng 0 (UTF-16 kết thúc bằng 2 byte 0, căn theo cặp). */
function afterTerminator(frame: Uint8Array, from: number, encoding: number): number {
  if (encoding === 1 || encoding === 2) {
    for (let i = from; i + 1 < frame.length; i += 2) if (frame[i] === 0 && frame[i + 1] === 0) return i + 2;
    return frame.length;
  }
  const i = frame.indexOf(0, from);
  return i < 0 ? frame.length : i + 1;
}

function pictureFrame(frame: Uint8Array, v22: boolean): Blob | undefined {
  const encoding = frame[0];
  let pos: number;
  let mime: string;
  if (v22) {
    mime = latin1(frame.subarray(1, 4)).toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg';
    pos = 4;
  } else {
    pos = afterTerminator(frame, 1, 0);
    mime = latin1(frame.subarray(1, pos - 1)) || 'image/jpeg';
    if (!mime.includes('/')) mime = `image/${mime.toLowerCase()}`;
  }
  pos = afterTerminator(frame, pos + 1, encoding); // bỏ loại ảnh (1 byte) + mô tả
  const data = frame.subarray(pos);
  return data.length ? new Blob([data.slice()], { type: mime }) : undefined;
}

async function readId3(file: Blob, head: Uint8Array): Promise<AudioTags> {
  const major = head[3];
  const flags = head[5];
  const size = Math.min(syncsafe(head, 6), MAX_TAG_BYTES);
  let body: Uint8Array = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
  if (flags & 0x80 && major < 4) body = removeUnsync(body);
  let pos = 0;
  if (flags & 0x40 && major >= 3) pos = major === 4 ? syncsafe(body, 0) : uint32(body, 0) + 4; // bỏ phần mở rộng

  const v22 = major === 2;
  const idLength = v22 ? 3 : 4;
  const headerLength = v22 ? 6 : 10;
  const tags: AudioTags = {};
  while (pos + headerLength <= body.length) {
    const id = latin1(body.subarray(pos, pos + idLength));
    if (!/^[A-Z0-9]+$/.test(id)) break; // tới phần đệm
    const frameSize = v22 ? (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5] : major === 4 ? syncsafe(body, pos + 4) : uint32(body, pos + 4);
    const frameFlags = v22 ? 0 : (body[pos + 8] << 8) | body[pos + 9];
    const start = pos + headerLength;
    const end = start + frameSize;
    if (frameSize <= 0 || end > body.length) break;
    pos = end;
    let frame = body.subarray(start, end);
    if (major === 4) {
      if (frameFlags & 0x000c) continue; // nén / mã hoá: bỏ qua
      if (frameFlags & 0x0040) frame = frame.subarray(1); // mã nhóm
      if (frameFlags & 0x0001) frame = frame.subarray(4); // độ dài gốc
      if (frameFlags & 0x0002) frame = removeUnsync(frame);
    } else if (major === 3) {
      if (frameFlags & 0x00c0) continue;
      if (frameFlags & 0x0020) frame = frame.subarray(1);
    }
    if (id === 'TIT2' || id === 'TT2') tags.title ??= textFrame(frame);
    else if (id === 'TPE1' || id === 'TP1') tags.artist ??= textFrame(frame);
    else if (id === 'TALB' || id === 'TAL') tags.album ??= textFrame(frame);
    else if (id === 'APIC' || id === 'PIC') tags.picture ??= pictureFrame(frame, v22);
  }
  return tags;
}

// ---------- MP4 / M4A (moov → udta → meta → ilst) ----------

interface Atom {
  type: string;
  /** vị trí bắt đầu nội dung (sau phần đầu của atom) */
  start: number;
  end: number;
}

function atoms(buf: Uint8Array, start = 0, end = buf.length): Atom[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const list: Atom[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = view.getUint32(pos);
    let header = 8;
    if (size === 1 && pos + 16 <= end) {
      size = Number(view.getBigUint64(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) break;
    list.push({ type: latin1(buf.subarray(pos + 4, pos + 8)), start: pos + header, end: pos + size });
    pos += size;
  }
  return list;
}

const child = (buf: Uint8Array, parent: Atom | undefined, type: string, skip = 0) =>
  parent ? atoms(buf, parent.start + skip, parent.end).find((a) => a.type === type) : undefined;

async function readMp4(file: Blob): Promise<AudioTags> {
  // Tìm atom moov ở cấp ngoài cùng (có file để moov ở cuối) mà không đọc cả file.
  let offset = 0;
  while (offset + 8 <= file.size) {
    const head = new Uint8Array(await file.slice(offset, offset + 16).arrayBuffer());
    const view = new DataView(head.buffer);
    let size = view.getUint32(0);
    let header = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(8));
      header = 16;
    } else if (size === 0) {
      size = file.size - offset;
    }
    if (size < header) break;
    if (latin1(head.subarray(4, 8)) === 'moov') {
      const moov = new Uint8Array(await file.slice(offset, offset + Math.min(size, MAX_TAG_BYTES)).arrayBuffer());
      return readIlst(moov, { type: 'moov', start: header, end: moov.length });
    }
    offset += size;
  }
  return {};
}

function readIlst(buf: Uint8Array, moov: Atom): AudioTags {
  const meta = child(buf, child(buf, moov, 'udta'), 'meta');
  const ilst = child(buf, meta, 'ilst', 4); // meta có 4 byte phiên bản/cờ trước các atom con
  const tags: AudioTags = {};
  for (const item of ilst ? atoms(buf, ilst.start, ilst.end) : []) {
    const data = child(buf, item, 'data');
    if (!data || data.end - data.start < 8) continue;
    const kind = new DataView(buf.buffer, buf.byteOffset).getUint32(data.start) & 0xffffff;
    const payload = buf.subarray(data.start + 8, data.end);
    const text = () => new TextDecoder().decode(payload).trim() || undefined;
    if (item.type === '©nam') tags.title ??= text();
    else if (item.type === '©ART') tags.artist ??= text();
    else if (item.type === 'aART') tags.artist ??= text();
    else if (item.type === '©alb') tags.album ??= text();
    else if (item.type === 'covr' && payload.length) tags.picture ??= new Blob([payload.slice()], { type: kind === 14 ? 'image/png' : 'image/jpeg' });
  }
  return tags;
}
