// Nhật ký lỗi trong app: không có Mac để gỡ lỗi trực tiếp nên mọi lỗi quan trọng được ghi lại
// và xem/copy ở Cài đặt → Nhật ký.
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  time: number;
  level: LogLevel;
  tag: string;
  message: string;
}

const MAX_ENTRIES = 400;
const STORAGE_KEY = 'melo.logs';
const entries: LogEntry[] = loadPersisted();
const listeners = new Set<() => void>();
/** Tăng mỗi khi nhật ký thay đổi (cho useSyncExternalStore). */
let version = 0;

function loadPersisted(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return [];
  }
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-150)));
    } catch {
      // bộ nhớ đầy hoặc bị chặn: bỏ qua
    }
  }, 500);
}

/**
 * Ẩn thông tin nhạy cảm trước khi ghi nhật ký (người dùng sẽ copy gửi đi khi báo lỗi):
 * link googlevideo (chứa IP + chữ ký), token OAuth, tham số bí mật, địa chỉ IP.
 */
export function redact(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'<>]*googlevideo\.com[^\s"'<>]*/gi, 'https://…googlevideo.com/[link đã ẩn]')
    .replace(/\b(Bearer)\s+[\w.~+/-]+=*/gi, '$1 ***')
    .replace(
      /\b(access_token|refresh_token|id_token|client_secret|device_code|code_verifier|code|state|token|pot|po_token|key|sig|signature|lsig|ip|ipbits)=[^&\s"'<>]+/gi,
      '$1=***'
    )
    .replace(/("(?:access_token|refresh_token|accessToken|refreshToken|id_token|client_secret|device_code|code_verifier)"\s*:\s*")[^"]*"/gi, '$1***"')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'x.x.x.x')
    .replace(/\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi, 'x:x:x:x');
}

/** Thông báo lỗi để hiện cho người dùng; lỗi của plugin Capacitor không phải lúc nào cũng là `Error`. */
export function errorMessage(err: unknown, fallback = String(err)): string {
  const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : '';
  return message || fallback;
}

function stringify(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Nhật ký vừa đổi: lưu (trễ một chút) và báo cho màn hình Nhật ký. */
function changed() {
  persistSoon();
  version += 1;
  listeners.forEach((fn) => fn());
}

function write(level: LogLevel, tag: string, parts: unknown[]) {
  const entry: LogEntry = { time: Date.now(), level, tag, message: redact(parts.map(stringify).join(' ')).slice(0, 2000) };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  console[level](`[${tag}]`, entry.message);
  changed();
}

export const log = {
  info: (tag: string, ...parts: unknown[]) => write('info', tag, parts),
  warn: (tag: string, ...parts: unknown[]) => write('warn', tag, parts),
  error: (tag: string, ...parts: unknown[]) => write('error', tag, parts)
};

export function getLogs(): readonly LogEntry[] {
  return entries;
}

export function clearLogs() {
  entries.length = 0;
  changed();
}

export function getLogVersion(): number {
  return version;
}

export function subscribeLogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function logsAsText(): string {
  return entries
    .map((e) => `${new Date(e.time).toISOString()} ${e.level.toUpperCase()} [${e.tag}] ${e.message}`)
    .join('\n');
}

export function installGlobalErrorLogging() {
  window.addEventListener('error', (event) => write('error', 'window', [event.message]));
  window.addEventListener('unhandledrejection', (event) => write('error', 'promise', [event.reason]));
}
