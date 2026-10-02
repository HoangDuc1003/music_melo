// Mục "Nguồn nhạc" trong Cài đặt của bản web: Client ID Jamendo và bộ nhớ trình duyệt đang dùng.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { SettingsRow } from '@/components/SettingsRow';
import { formatBytes } from '@/lib/format';
import { runAction } from '@/ui/overlays';
import { DEVPORTAL_URL, getJamendoClientId, isValidJamendoClientId, setJamendoClientId } from '@/web/jamendo';
import { storageUsage, type StorageUsage } from '@/web/pwa';

function ClientIdForm({ initial, onDone }: { initial: string; onDone: (id: string) => void }) {
  const [value, setValue] = useState(initial);
  const queryClient = useQueryClient();
  const save = () =>
    runAction(async () => {
      await setJamendoClientId(value);
      await queryClient.invalidateQueries();
      onDone(value.trim());
    }, 'Đã lưu Client ID Jamendo');
  return (
    <div className="mx-4 my-2 rounded-xl bg-white/5 p-4 text-[13px] leading-relaxed text-subdued">
      <p>Jamendo là kho nhạc Creative Commons (nghe và tải miễn phí). Cần một mã Client ID miễn phí, làm một lần khoảng 2 phút:</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Mở{' '}
          <a className="text-accent underline" href={DEVPORTAL_URL} target="_blank" rel="noopener noreferrer">
            devportal.jamendo.com
          </a>
          , đăng ký tài khoản.
        </li>
        <li>Vào My Applications → Create a new application, đặt tên Melo.</li>
        <li>Copy Client ID dán vào đây.</li>
      </ol>
      <input
        className="mt-3 w-full rounded-lg bg-black/40 px-3 py-2.5 font-mono text-[13px] text-white outline-none placeholder:text-white/30"
        placeholder="Client ID"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value.trim())}
        aria-label="Client ID Jamendo"
      />
      <button className="mt-3 w-full rounded-full bg-accent py-2.5 font-bold text-black disabled:opacity-40" disabled={!isValidJamendoClientId(value)} onClick={() => void save()}>
        Lưu
      </button>
    </div>
  );
}

function storageDetail(usage: StorageUsage | undefined): string {
  if (!usage) return 'Trình duyệt không cho biết';
  const free = Math.max(0, usage.quota - usage.used);
  return `Đã dùng ${formatBytes(usage.used)} • còn khoảng ${formatBytes(free)}${usage.persisted ? '' : ' • có thể bị xoá khi máy đầy'}`;
}

export function WebSources() {
  const [clientId, setClientId] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [usage, setUsage] = useState<StorageUsage>();
  useEffect(() => {
    void getJamendoClientId().then((id) => {
      setClientId(id);
      if (!id) setEditing(true);
    });
    void storageUsage().then(setUsage);
  }, []);

  return (
    <>
      <SettingsRow
        label="Jamendo"
        detail={clientId ? `Đã có Client ID ${clientId.slice(0, 4)}…` : 'Chưa có Client ID: cần để tìm và nghe nhạc'}
        onClick={() => setEditing((v) => !v)}
      />
      {editing && (
        <ClientIdForm
          initial={clientId ?? ''}
          onDone={(id) => {
            setClientId(id);
            setEditing(false);
          }}
        />
      )}
      <SettingsRow label="Bộ nhớ trên máy" detail={storageDetail(usage)} />
    </>
  );
}
