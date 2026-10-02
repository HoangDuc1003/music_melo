// Mục "Nguồn nhạc" trong Cài đặt của bản web: khoá API YouTube và trang tải MP3 (tuỳ chọn), Audius (luôn bật),
// Client ID Jamendo (tuỳ chọn), bộ nhớ trình duyệt đang dùng.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { SettingsRow } from '@/components/SettingsRow';
import { formatBytes } from '@/lib/format';
import { runAction } from '@/ui/overlays';
import { DEVPORTAL_URL, getJamendoClientId, isValidJamendoClientId, setJamendoClientId } from '@/web/jamendo';
import { storageUsage, type StorageUsage } from '@/web/pwa';
import { getYouTubeApiKey, isValidYouTubeApiKey, setYouTubeApiKey } from '@/web/youtube';
import { getConverterUrl, isValidConverterUrl, setConverterUrl } from '@/web/youtube-files';

const GUIDE_URL = 'https://github.com/HoangDuc1003/music_melo/blob/main/docs/WEB.md';

const Link = ({ href, children }: { href: string; children: ReactNode }) => (
  <a className="text-accent underline" href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

interface KeyFormProps {
  label: string;
  placeholder: string;
  initial: string;
  valid: (value: string) => boolean;
  save: (value: string) => Promise<void>;
  done: string;
  onDone: (value: string) => void;
  children: ReactNode;
}

/** Ô nhập mã (khoá API, Client ID) + hướng dẫn lấy mã; lưu xong thì tải lại dữ liệu các trang. */
function KeyForm({ label, placeholder, initial, valid, save, done, onDone, children }: KeyFormProps) {
  const [value, setValue] = useState(initial);
  const queryClient = useQueryClient();
  const submit = () =>
    runAction(async () => {
      await save(value);
      await queryClient.invalidateQueries();
      onDone(value.trim());
    }, done);
  return (
    <div className="mx-4 my-2 rounded-xl bg-white/5 p-4 text-[13px] leading-relaxed text-subdued">
      {children}
      <input
        className="mt-3 w-full rounded-lg bg-black/40 px-3 py-2.5 font-mono text-[13px] text-white outline-none placeholder:text-white/30"
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value.trim())}
        aria-label={label}
      />
      <div className="mt-3 flex gap-2">
        <button className="flex-1 rounded-full bg-accent py-2.5 font-bold text-black disabled:opacity-40" disabled={!valid(value)} onClick={() => void submit()}>
          Lưu
        </button>
        {initial && (
          <button className="rounded-full border border-white/20 px-4 text-white" onClick={() => void runAction(() => save('').then(() => onDone('')), 'Đã xoá')}>
            Xoá
          </button>
        )}
      </div>
    </div>
  );
}

function storageDetail(usage: StorageUsage | undefined): string {
  if (!usage) return 'Trình duyệt không cho biết';
  const free = Math.max(0, usage.quota - usage.used);
  return `Đã dùng ${formatBytes(usage.used)} • còn khoảng ${formatBytes(free)}${usage.persisted ? '' : ' • có thể bị xoá khi máy đầy'}`;
}

const short = (value: string) => `${value.slice(0, 6)}…`;

type Editing = 'youtube' | 'converter' | 'jamendo';

const hostOf = (url: string) => {
  try {
    return new URL(url.replace(/\{(url|id)\}/g, 'x')).hostname;
  } catch {
    return url;
  }
};

export function WebSources() {
  const [youtubeKey, setYoutubeKey] = useState<string>();
  const [jamendoId, setJamendoId] = useState<string>();
  const [converter, setConverter] = useState<string>();
  const [editing, setEditing] = useState<Editing>();
  const [usage, setUsage] = useState<StorageUsage>();
  useEffect(() => {
    void getYouTubeApiKey().then(setYoutubeKey);
    void getJamendoClientId().then(setJamendoId);
    void getConverterUrl().then((url) => setConverter(url || undefined));
    void storageUsage().then(setUsage);
  }, []);
  const toggle = (source: Editing) => setEditing((current) => (current === source ? undefined : source));
  const finish = (set: (value: string | undefined) => void) => (value: string) => {
    set(value || undefined);
    setEditing(undefined);
  };

  return (
    <>
      <SettingsRow
        label="YouTube (tuỳ chọn)"
        detail={youtubeKey ? `Đã có khoá API ${short(youtubeKey)} • xem online` : 'Tìm mọi bài hát, MV trên YouTube: cần khoá API miễn phí'}
        onClick={() => toggle('youtube')}
      />
      {editing === 'youtube' && (
        <KeyForm
          label="Khoá API YouTube"
          placeholder="AIza…"
          initial={youtubeKey ?? ''}
          valid={isValidYouTubeApiKey}
          save={setYouTubeApiKey}
          done="Đã lưu khoá API YouTube"
          onDone={finish(setYoutubeKey)}
        >
          <p>Khoá API miễn phí của Google Cloud, làm một lần khoảng 5 phút (hướng dẫn có hình trong <Link href={GUIDE_URL}>WEB.md</Link>):</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Mở <Link href="https://console.cloud.google.com/apis/library/youtube.googleapis.com">Google Cloud</Link>, tạo project và bấm
              Enable cho YouTube Data API v3.
            </li>
            <li>Credentials → Create credentials → API key.</li>
            <li>Sửa khoá: Website restrictions = địa chỉ web của Melo, API restrictions = YouTube Data API v3.</li>
            <li>Copy khoá (bắt đầu bằng AIza) dán vào đây.</li>
          </ol>
          <p className="mt-2">Video YouTube phát trong khung video trên cùng màn hình (xem online). Muốn nghe offline thì tải MP3 qua trang chuyển đổi (mục bên dưới). Mỗi ngày tìm được khoảng 100 lần.</p>
        </KeyForm>
      )}
      <SettingsRow
        label="Trang tải MP3 từ YouTube"
        detail={converter ? `${hostOf(converter)} • menu ⋮ của video → Tải MP3` : 'Trang chuyển đổi bạn hay dùng: tải MP3 về máy để nghe offline'}
        onClick={() => toggle('converter')}
      />
      {editing === 'converter' && (
        <KeyForm
          label="Trang tải MP3 từ YouTube"
          placeholder="https://…/?url={url}"
          initial={converter ?? ''}
          valid={isValidConverterUrl}
          save={setConverterUrl}
          done="Đã lưu trang tải MP3"
          onDone={finish(setConverter)}
        >
          <p>
            Bản web không tự tải được nhạc YouTube, nên Melo mở trang chuyển đổi bạn hay dùng (trang yt2…, y2mate…) kèm link video. Tải MP3 về
            app Tệp xong, quay lại Melo chọn file: bài đó nghe offline được, tắt màn hình vẫn phát.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Dán địa chỉ trang, ví dụ https://trang-cua-ban.com.</li>
            <li>
              Nếu trang nhận link video ngay trên địa chỉ, thay link bằng <b className="text-white">{'{url}'}</b> (hoặc <b className="text-white">{'{id}'}</b> cho
              id video), ví dụ https://trang-cua-ban.com/?url={'{url}'}. Không thì Melo copy sẵn link, bạn dán vào ô của trang.
            </li>
            <li>Các trang này hay có quảng cáo và nút tải giả: chỉ bấm nút tải MP3, không cài app hay cho phép thông báo.</li>
          </ul>
        </KeyForm>
      )}
      <SettingsRow label="Audius" detail="Đang dùng • không cần đăng ký • bài mới mỗi ngày" />
      <SettingsRow
        label="Jamendo (tuỳ chọn)"
        detail={jamendoId ? `Đã có Client ID ${short(jamendoId)}` : 'Thêm kho nhạc Creative Commons: cần Client ID miễn phí'}
        onClick={() => toggle('jamendo')}
      />
      {editing === 'jamendo' && (
        <KeyForm
          label="Client ID Jamendo"
          placeholder="Client ID"
          initial={jamendoId ?? ''}
          valid={isValidJamendoClientId}
          save={setJamendoClientId}
          done="Đã lưu Client ID Jamendo"
          onDone={finish(setJamendoId)}
        >
          <p>Jamendo là kho nhạc Creative Commons (nghe và tải miễn phí), thêm vào bên cạnh Audius. Cần một mã Client ID miễn phí, làm một lần khoảng 2 phút:</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Mở <Link href={DEVPORTAL_URL}>devportal.jamendo.com</Link>, đăng ký tài khoản.
            </li>
            <li>Vào My Applications → Create a new application, đặt tên Melo.</li>
            <li>Copy Client ID dán vào đây.</li>
          </ol>
        </KeyForm>
      )}
      <SettingsRow label="Bộ nhớ trên máy" detail={storageDetail(usage)} />
    </>
  );
}
