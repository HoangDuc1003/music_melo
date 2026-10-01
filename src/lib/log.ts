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

function stringify(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level: LogLevel, tag: string, parts: unknown[]) {
  const entry: LogEntry = { time: Date.now(), level, tag, message: parts.map(stringify).join(' ') };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  consoleFn(`[${tag}]`, ...parts);
  persistSoon();
  version += 1;
  listeners.forEach((fn) => fn());
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
  persistSoon();
  version += 1;
  listeners.forEach((fn) => fn());
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
