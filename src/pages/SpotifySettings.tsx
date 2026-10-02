// Mục "Spotify" trong Cài đặt: kết nối, đồng bộ, tự đồng bộ, nhập từ file dữ liệu Spotify.
import { Browser } from '@capacitor/browser';
import { ChevronRight, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isNative } from '@/lib/platform';
import { getClientId, NATIVE_REDIRECT, redirectUri } from '@/sync/spotify-auth';
import { connectSpotify, disconnectSpotify, importSpotifyExport, setSpotifyAutoSync, syncSpotify, useSpotify } from '@/sync/spotify-sync';
import { toast } from '@/ui/overlays';

const GUIDE_URL = 'https://github.com/HoangDuc1003/spoti_music/blob/main/docs/SPOTIFY.md';

function openExternal(url: string) {
  if (isNative) void Browser.open({ url });
  else window.open(url, '_blank', 'noopener');
}

function when(at: number | undefined): string {
  if (!at) return '';
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return today ? `lúc ${time} hôm nay` : `${time} ${d.toLocaleDateString('vi-VN')}`;
}

function Row({ label, detail, onClick, right, danger }: { label: string; detail?: string; onClick?: () => void; right?: React.ReactNode; danger?: boolean }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/5 disabled:opacity-50" onClick={onClick}>
      <div className="min-w-0 flex-1">
        <div className={`text-[15px] ${danger ? 'text-red-400' : ''}`}>{label}</div>
        {detail && <div className="text-[12px] text-subdued">{detail}</div>}
      </div>
      {right ?? (onClick && <ChevronRight size={18} className="text-subdued" />)}
    </Tag>
  );
}

function run(action: () => Promise<unknown>) {
  action().catch((err) => toast(err instanceof Error ? err.message : 'Có lỗi xảy ra'));
}

/** Nhập Client ID của app Spotify tự tạo (lần đầu). */
function ClientIdSetup({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('');
  const copy = () =>
    navigator.clipboard
      .writeText(isNative ? NATIVE_REDIRECT : redirectUri())
      .then(() => toast('Đã copy Redirect URI'))
      .catch(() => toast('Không copy được'));
  return (
    <div className="mx-4 my-2 rounded-xl bg-white/5 p-4 text-[13px] leading-relaxed">
      <p className="text-subdued">
        Spotify chỉ cho app cá nhân đọc thư viện khi bạn tự tạo một "app Spotify" (cần <b className="text-white">Spotify Premium</b>, quy định
        từ 2/2026). Làm một lần, khoảng 3 phút.
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-subdued">
        <li>
          Vào <b className="text-white">developer.spotify.com/dashboard</b> → Create app.
        </li>
        <li>
          Redirect URI: dán <code className="rounded bg-black/40 px-1 text-accent">{isNative ? NATIVE_REDIRECT : redirectUri()}</code>
          <button className="ml-1 inline-flex align-middle text-subdued" aria-label="Copy Redirect URI" onClick={copy}>
            <Copy size={14} />
          </button>
        </li>
        <li>Chọn Web API → Save, rồi copy Client ID dán vào đây.</li>
      </ol>
      <input
        className="mt-3 w-full rounded-lg bg-black/40 px-3 py-2.5 font-mono text-[13px] outline-none placeholder:text-white/30"
        placeholder="Client ID (32 ký tự)"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value.trim())}
        aria-label="Client ID của app Spotify"
      />
      <div className="mt-3 flex gap-2">
        <button
          className="flex-1 rounded-full bg-accent py-2.5 font-bold text-black disabled:opacity-40"
          disabled={!/^[0-9a-f]{32}$/i.test(value)}
          onClick={() => run(() => connectSpotify(value).then(onDone))}
        >
          Lưu và đăng nhập Spotify
        </button>
        <button className="rounded-full border border-white/20 px-4 text-[13px]" onClick={() => openExternal(GUIDE_URL)}>
          Hướng dẫn
        </button>
      </div>
    </div>
  );
}

export function SpotifySection() {
  const s = useSpotify();
  const [setup, setSetup] = useState(false);
  const [hasClientId, setHasClientId] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getClientId().then((id) => setHasClientId(Boolean(id)));
  }, [s.connected, setup]);

  const syncDetail = s.syncing
    ? `${s.phase ?? 'Đang đồng bộ…'}${s.total ? ` ${s.done}/${s.total}` : ''}`
    : s.lastResult
      ? `${s.lastResult} • ${when(s.lastSyncAt)}`
      : s.lastSyncAt
        ? `Lần cuối ${when(s.lastSyncAt)}`
        : 'Chưa đồng bộ lần nào';

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    if (fileInput.current) fileInput.current.value = '';
    toast('Đang nhập, có thể mất vài phút…');
    run(() => importSpotifyExport(list).then((message) => toast(message)));
  };

  return (
    <>
      {s.connected ? (
        <>
          <Row label="Spotify" detail={`Đã kết nối${s.user ? ` • ${s.user}` : ''}`} />
          <Row label={s.syncing ? 'Đang đồng bộ…' : 'Đồng bộ ngay'} detail={syncDetail} onClick={s.syncing ? undefined : () => void syncSpotify()} />
          {s.syncing && s.total > 0 && (
            <div className="mx-4 -mt-1 mb-2 h-1 rounded-full bg-white/15">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(s.done / s.total) * 100}%` }} />
            </div>
          )}
          <Row
            label="Tự đồng bộ khi mở app"
            detail="Tối đa 2 lần mỗi ngày, playlist không đổi thì bỏ qua"
            right={
              <input
                type="checkbox"
                className="toggle"
                checked={s.autoSync}
                onChange={(e) => void setSpotifyAutoSync(e.target.checked)}
                aria-label="Tự đồng bộ Spotify khi mở app"
              />
            }
          />
          <Row
            label="Ngắt kết nối Spotify"
            danger
            onClick={() => {
              if (!window.confirm('Ngắt kết nối Spotify? Melo sẽ xoá mã đăng nhập khỏi máy.')) return;
              const remove = window.confirm('Xoá luôn các playlist đã đồng bộ từ Spotify khỏi Melo?');
              run(() => disconnectSpotify(remove).then(() => toast('Đã ngắt kết nối Spotify')));
            }}
          />
        </>
      ) : (
        <>
          <Row
            label="Kết nối Spotify"
            detail="Đồng bộ playlist và Bài hát đã thích về Melo (có thể đăng nhập Spotify bằng Google)"
            onClick={() => (hasClientId && !setup ? run(() => connectSpotify()) : setSetup((v) => !v))}
          />
          {setup && <ClientIdSetup onDone={() => setSetup(false)} />}
          {hasClientId && !setup && (
            <Row label="Đổi Client ID" detail="Dùng app Spotify khác" onClick={() => setSetup(true)} />
          )}
        </>
      )}
      <Row
        label="Nhập từ file dữ liệu Spotify"
        detail="Không có Premium: Spotify → Tài khoản → Quyền riêng tư → Tải dữ liệu, rồi chọn Playlist1.json / YourLibrary.json"
        onClick={s.syncing ? undefined : () => fileInput.current?.click()}
      />
      <input ref={fileInput} type="file" accept="application/json,.json" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      {s.error && <p className="px-4 pb-2 text-[12px] text-red-400">{s.error}</p>}
    </>
  );
}
