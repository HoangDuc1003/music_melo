// Mục "YouTube (Gmail)" trong Cài đặt: đăng nhập Google bằng mã, đồng bộ playlist + bài đã thích, tự đồng bộ.
import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ProgressBar } from '@/components/ProgressBar';
import { SettingsRow, Toggle } from '@/components/SettingsRow';
import { getGoogleClient, isValidGoogleClientId, setGoogleClient } from '@/sync/google-auth';
import { cancelGoogleLogin, connectGoogle, disconnectGoogle, setYouTubeAutoSync, syncYouTube, useYouTubeSync } from '@/sync/youtube-sync';
import { copyText, runAction } from '@/ui/overlays';
import { openExternal, syncDetail } from './settings-shared';

const GUIDE_URL = 'https://github.com/HoangDuc1003/spoti_music/blob/main/docs/GOOGLE.md';

const inputClass = 'mt-2 w-full rounded-lg bg-black/40 px-3 py-2.5 font-mono text-[13px] text-white outline-none placeholder:text-white/30';

/** Nhập Client ID + Client secret của OAuth client tự tạo (lần đầu). */
function ClientSetup({ onDone }: { onDone: () => void }) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const save = () => runAction(() => setGoogleClient(clientId, secret).then(onDone), 'Đã lưu, bấm Đăng nhập bằng Gmail');
  return (
    <div className="mx-4 my-2 rounded-xl bg-white/5 p-4 text-[13px] leading-relaxed text-subdued">
      <p>
        Google chỉ cho app cá nhân đọc thư viện YouTube khi bạn tự tạo một "OAuth client" miễn phí trong Google Cloud (loại{' '}
        <b className="text-white">TVs and Limited Input devices</b>). Làm một lần, khoảng 5 phút.
      </p>
      <input className={inputClass} placeholder="Client ID (….apps.googleusercontent.com)" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={clientId} onChange={(e) => setClientId(e.target.value.trim())} aria-label="Client ID của Google" />
      <input className={inputClass} placeholder="Client secret" type="password" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={secret} onChange={(e) => setSecret(e.target.value.trim())} aria-label="Client secret của Google" />
      <p className="mt-2 text-[12px]">Client secret được cất trong Keychain của iPhone, không gửi đi đâu ngoài Google.</p>
      <div className="mt-3 flex gap-2">
        <button className="flex-1 rounded-full bg-accent py-2.5 font-bold text-black disabled:opacity-40" disabled={!isValidGoogleClientId(clientId) || secret.length < 8} onClick={() => void save()}>
          Lưu
        </button>
        <button className="rounded-full border border-white/20 px-4 text-[13px] text-white" onClick={() => openExternal(GUIDE_URL)}>
          Hướng dẫn
        </button>
      </div>
    </div>
  );
}

/** Đang chờ người dùng nhập mã ở google.com/device. */
function LoginCode({ code, url }: { code: string; url: string }) {
  return (
    <div className="mx-4 my-2 rounded-xl bg-white/5 p-4 text-center text-[13px] text-subdued">
      <p>
        Mở <b className="text-white">{url.replace(/^https?:\/\/(www\.)?/, '')}</b>, chọn tài khoản Gmail rồi nhập mã:
      </p>
      <button className="mx-auto mt-3 flex items-center gap-2 rounded-lg bg-black/40 px-4 py-2 font-mono text-[24px] font-bold tracking-widest text-white" onClick={() => copyText(code, 'Đã copy mã')} aria-label="Copy mã đăng nhập">
        {code}
        <Copy size={16} className="text-subdued" />
      </button>
      <div className="mt-3 flex gap-2">
        <button className="flex-1 rounded-full bg-accent py-2.5 font-bold text-black" onClick={() => openExternal(url)}>
          Mở trang Google
        </button>
        <button className="rounded-full border border-white/20 px-4 text-white" onClick={cancelGoogleLogin}>
          Huỷ
        </button>
      </div>
      <p className="mt-3 animate-pulse">Đang chờ bạn xác nhận…</p>
    </div>
  );
}

export function GoogleSection() {
  const s = useYouTubeSync();
  const [setup, setSetup] = useState(false);
  const [hasClient, setHasClient] = useState(false);

  useEffect(() => {
    void getGoogleClient().then((client) => setHasClient(Boolean(client)));
  }, [s.connected, setup]);

  if (s.login) return <LoginCode code={s.login.userCode} url={s.login.verificationUrl} />;

  return (
    <>
      {s.connected ? (
        <>
          <SettingsRow label="Tài khoản Google" detail={s.email ? `Đã đăng nhập • ${s.email}` : 'Đã đăng nhập'} />
          <SettingsRow label={s.syncing ? 'Đang đồng bộ…' : 'Đồng bộ ngay'} detail={syncDetail(s)} onClick={s.syncing ? undefined : () => void syncYouTube()} />
          {s.syncing && s.total > 0 && <ProgressBar ratio={s.done / s.total} className="mx-4 -mt-1 mb-2" />}
          <SettingsRow
            label="Tự đồng bộ khi mở app"
            detail="Tối đa 2 lần mỗi ngày, playlist không đổi thì bỏ qua"
            right={<Toggle checked={s.autoSync} onChange={(on) => void setYouTubeAutoSync(on)} label="Tự đồng bộ YouTube khi mở app" />}
          />
          <SettingsRow
            label="Đăng xuất Google"
            danger
            onClick={() => {
              if (!window.confirm('Đăng xuất Google? Melo sẽ thu hồi quyền đọc YouTube và xoá mã đăng nhập khỏi máy.')) return;
              const remove = window.confirm('Xoá luôn các playlist đã đồng bộ từ YouTube khỏi Melo?');
              void runAction(() => disconnectGoogle(remove), 'Đã đăng xuất Google');
            }}
          />
        </>
      ) : (
        <>
          <SettingsRow
            label="Đăng nhập bằng Gmail"
            detail="Đồng bộ playlist và bài đã thích từ YouTube / YouTube Music về Melo"
            onClick={() => (hasClient && !setup ? void runAction(connectGoogle) : setSetup((v) => !v))}
          />
          {setup && <ClientSetup onDone={() => setSetup(false)} />}
          {hasClient && !setup && <SettingsRow label="Đổi Client ID Google" detail="Dùng OAuth client khác" onClick={() => setSetup(true)} />}
        </>
      )}
      {s.error && <p className="px-4 pb-2 text-[12px] text-red-400">{s.error}</p>}
    </>
  );
}
