import { useEffect, useState, useSyncExternalStore } from 'react';
import { getAutoDownloadLiked, removeAllDownloads, setAutoDownloadLiked, totalDownloadedBytes, useDownloads } from '@/downloads/manager';
import { formatBytes } from '@/lib/format';
import { ChevronRight, Copy, Trash2 } from 'lucide-react';
import { Centered, Page } from '@/components/Page';
import { db } from '@/lib/db';
import { clearHistory, clearSearches } from '@/lib/library';
import { clearLogs, getLogs, getLogVersion, logsAsText, subscribeLogs } from '@/lib/log';
import { setAutoplay } from '@/player/controller';
import { usePlayer } from '@/player/store';
import { navigate } from '@/ui/nav';
import { openSleepTimer, toast } from '@/ui/overlays';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="px-4 pb-1 text-[13px] font-semibold uppercase tracking-wider text-subdued">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function Item({ label, detail, onClick, right }: { label: string; detail?: string; onClick?: () => void; right?: React.ReactNode }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/5" onClick={onClick}>
      <div className="min-w-0 flex-1">
        <div className="text-[15px]">{label}</div>
        {detail && <div className="text-[12px] text-subdued">{detail}</div>}
      </div>
      {right ?? (onClick && <ChevronRight size={18} className="text-subdued" />)}
    </Tag>
  );
}

function confirmThen(message: string, action: () => Promise<unknown>, done: string) {
  if (!window.confirm(message)) return;
  void action().then(() => toast(done));
}

function useAutoDownloadLiked(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(false);
  useEffect(() => {
    void getAutoDownloadLiked().then(setValue);
  }, []);
  return [value, (v) => (setValue(v), void setAutoDownloadLiked(v))];
}

export function SettingsPage() {
  const autoplay = usePlayer((s) => s.autoplay);
  const rows = useDownloads((s) => s.rows);
  const doneCount = [...rows.values()].filter((r) => r.status === 'done').length;
  const [autoLiked, setAutoLiked] = useAutoDownloadLiked();
  return (
    <Page title="Cài đặt" solidHeader>
      <h1 className="px-4 pt-2 text-[24px] font-bold">Cài đặt</h1>

      <Section title="Phát nhạc">
        <Item
          label="Tự phát bài tương tự"
          detail="Hết hàng chờ thì phát tiếp radio từ YouTube Music"
          right={<input type="checkbox" className="toggle" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} aria-label="Tự phát bài tương tự" />}
        />
        <Item label="Hẹn giờ tắt" detail="Dừng nhạc sau một khoảng thời gian" onClick={openSleepTimer} />
      </Section>

      <Section title="Tải về">
        <Item label="Đã tải" detail={`${doneCount} bài • ${formatBytes(totalDownloadedBytes(rows.values()))}`} onClick={() => navigate({ name: 'downloads' })} />
        <Item
          label="Tự tải bài hát đã thích"
          detail="Bấm ♡ là bài được tải về để nghe offline"
          right={<input type="checkbox" className="toggle" checked={autoLiked} onChange={(e) => setAutoLiked(e.target.checked)} aria-label="Tự tải bài hát đã thích" />}
        />
        {doneCount > 0 && (
          <Item label="Xoá tất cả bài đã tải" onClick={() => confirmThen('Xoá tất cả bài đã tải khỏi máy?', removeAllDownloads, 'Đã xoá tất cả bài đã tải')} />
        )}
      </Section>

      <Section title="Dữ liệu trên máy">
        <Item label="Xoá lịch sử nghe" onClick={() => confirmThen('Xoá toàn bộ lịch sử nghe?', clearHistory, 'Đã xoá lịch sử nghe')} />
        <Item label="Xoá lịch sử tìm kiếm" onClick={() => confirmThen('Xoá lịch sử tìm kiếm?', clearSearches, 'Đã xoá lịch sử tìm kiếm')} />
        <Item label="Xoá lời bài hát đã lưu" onClick={() => confirmThen('Xoá lời bài hát đã lưu?', () => db.lyrics.clear(), 'Đã xoá')} />
      </Section>

      <Section title="Gỡ lỗi">
        <Item label="Nhật ký lỗi" detail="Copy gửi cho người sửa app khi có lỗi" onClick={() => navigate({ name: 'logs' })} />
      </Section>

      <Section title="Thông tin">
        <Item label="Phiên bản" detail={`Melo ${__APP_VERSION__}`} />
        <p className="px-4 pt-2 text-[12px] leading-relaxed text-subdued">
          App dùng cá nhân, không phát hành trên App Store. Nhạc lấy từ YouTube Music ngay trên máy, không qua máy chủ nào.
        </p>
      </Section>
    </Page>
  );
}

export function LogsPage() {
  useSyncExternalStore(subscribeLogs, getLogVersion);
  const entries = getLogs();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logsAsText());
      toast('Đã copy nhật ký');
    } catch {
      toast('Không copy được, hãy chụp màn hình');
    }
  };
  return (
    <Page
      title="Nhật ký"
      solidHeader
      right={
        <div className="flex gap-1">
          <button className="p-2" aria-label="Copy nhật ký" onClick={() => void copy()}>
            <Copy size={20} />
          </button>
          <button className="p-2" aria-label="Xoá nhật ký" onClick={clearLogs}>
            <Trash2 size={20} />
          </button>
        </div>
      }
    >
      {entries.length === 0 && <Centered>Chưa có gì.</Centered>}
      <div className="px-3 font-mono text-[11px] leading-relaxed">
        {[...entries].reverse().map((e, i) => (
          <div key={`${e.time}-${i}`} className={`border-b border-white/5 py-1.5 ${e.level === 'error' ? 'text-red-300' : e.level === 'warn' ? 'text-yellow-200' : 'text-white/80'}`}>
            <span className="text-white/40">{new Date(e.time).toLocaleTimeString('vi-VN')}</span> [{e.tag}] {e.message}
          </div>
        ))}
      </div>
    </Page>
  );
}
