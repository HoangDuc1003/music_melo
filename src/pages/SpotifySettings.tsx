// Mục "Spotify" trong Cài đặt: kết nối, đồng bộ, tự đồng bộ, nhập từ file dữ liệu Spotify.
import { Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ProgressBar } from '@/components/ProgressBar';
import { SettingsRow, Toggle } from '@/components/SettingsRow';
import { getClientId, isValidClientId, redirectUri } from '@/sync/spotify-auth';
import { connectSpotify, disconnectSpotify, importSpotifyExport, setSpotifyAutoSync, syncSpotify, useSpotify } from '@/sync/spotify-sync';
import { copyText, runAction, toast } from '@/ui/overlays';
import { openExternal, syncDetail } from './settings-shared';

const GUIDE_URL = 'https://github.com/HoangDuc1003/music_melo/blob/main/docs/SPOTIFY.md';

/** Nhập Client ID của app Spotify tự tạo (lần đầu). */
function ClientIdSetup({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('');
  const redirect = redirectUri();
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
          Redirect URI: dán <code className="rounded bg-black/40 px-1 text-accent">{redirect}</code>
          <button className="ml-1 inline-flex align-middle text-subdued" aria-label="Copy Redirect URI" onClick={() => copyText(redirect, 'Đã copy Redirect URI')}>
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
          disabled={!isValidClientId(value)}
          onClick={() => void runAction(() => connectSpotify(value).then(onDone))}
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

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    if (fileInput.current) fileInput.current.value = '';
    toast('Đang nhập, có thể mất vài phút…');
    void runAction(async () => toast(await importSpotifyExport(list)));
  };

  return (
    <>
      {s.connected ? (
        <>
          <SettingsRow label="Spotify" detail={`Đã kết nối${s.user ? ` • ${s.user}` : ''}`} />
          <SettingsRow label={s.syncing ? 'Đang đồng bộ…' : 'Đồng bộ ngay'} detail={syncDetail(s)} onClick={s.syncing ? undefined : () => void syncSpotify()} />
          {s.syncing && s.total > 0 && <ProgressBar ratio={s.done / s.total} className="mx-4 -mt-1 mb-2" />}
          <SettingsRow
            label="Tự đồng bộ khi mở app"
            detail="Tối đa 2 lần mỗi ngày, playlist không đổi thì bỏ qua"
            right={<Toggle checked={s.autoSync} onChange={(on) => void setSpotifyAutoSync(on)} label="Tự đồng bộ Spotify khi mở app" />}
          />
          <SettingsRow
            label="Ngắt kết nối Spotify"
            danger
            onClick={() => {
              if (!window.confirm('Ngắt kết nối Spotify? Melo sẽ xoá mã đăng nhập khỏi máy.')) return;
              const remove = window.confirm('Xoá luôn các playlist đã đồng bộ từ Spotify khỏi Melo?');
              void runAction(() => disconnectSpotify(remove), 'Đã ngắt kết nối Spotify');
            }}
          />
        </>
      ) : (
        <>
          <SettingsRow
            label="Kết nối Spotify"
            detail="Đồng bộ playlist và Bài hát đã thích về Melo (có thể đăng nhập Spotify bằng Google)"
            onClick={() => (hasClientId && !setup ? void runAction(() => connectSpotify()) : setSetup((v) => !v))}
          />
          {setup && <ClientIdSetup onDone={() => setSetup(false)} />}
          {hasClientId && !setup && <SettingsRow label="Đổi Client ID" detail="Dùng app Spotify khác" onClick={() => setSetup(true)} />}
        </>
      )}
      <SettingsRow
        label="Nhập từ file dữ liệu Spotify"
        detail="Không có Premium: Spotify → Tài khoản → Quyền riêng tư → Tải dữ liệu, rồi chọn Playlist1.json / YourLibrary.json"
        onClick={s.syncing ? undefined : () => fileInput.current?.click()}
      />
      <input ref={fileInput} type="file" accept="application/json,.json" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      {s.error && <p className="px-4 pb-2 text-[12px] text-red-400">{s.error}</p>}
    </>
  );
}
