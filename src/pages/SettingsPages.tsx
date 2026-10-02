import { lazy, Suspense, useSyncExternalStore } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { Centered, Page } from '@/components/Page';
import { SettingsRow, Toggle } from '@/components/SettingsRow';
import { CELLULAR_MAX, removeAllDownloads, setDownloadSettings, totalDownloadedBytes, useDownloads, type ConcurrencySetting } from '@/downloads/manager';
import { db } from '@/lib/db';
import { formatBytes } from '@/lib/format';
import { clearHistory, clearSearches } from '@/lib/library';
import { clearLogs, getLogs, getLogVersion, logsAsText, subscribeLogs, type LogLevel } from '@/lib/log';
import { setAutoplay } from '@/player/controller';
import { usePlayer } from '@/player/store';
import { navigate } from '@/ui/nav';
import { confirmAction, copyText, openSleepTimer } from '@/ui/overlays';
import { WebSources } from './WebSettings';

// Phần đồng bộ tài khoản nạp riêng (không làm nặng lúc mở app); bản web không có YouTube/Spotify.
const SpotifySection = __WEB_APP__ ? () => null : lazy(() => import('./SpotifySettings').then((m) => ({ default: m.SpotifySection })));
const GoogleSection = __WEB_APP__ ? () => null : lazy(() => import('./GoogleSettings').then((m) => ({ default: m.GoogleSection })));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="px-4 pb-1 text-[13px] font-semibold uppercase tracking-wider text-subdued">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const autoplay = usePlayer((s) => s.autoplay);
  const rows = useDownloads((s) => s.rows);
  const doneCount = [...rows.values()].filter((r) => r.status === 'done').length;
  const downloadSettings = useDownloads((s) => s.settings);
  return (
    <Page title="Cài đặt" solidHeader>
      <h1 className="px-4 pt-2 text-[24px] font-bold">Cài đặt</h1>

      <Section title="Phát nhạc">
        <SettingsRow
          label="Tự phát bài tương tự"
          detail={__WEB_APP__ ? 'Hết hàng chờ thì phát tiếp các bài cùng thể loại' : 'Hết hàng chờ thì phát tiếp radio từ YouTube Music'}
          right={<Toggle checked={autoplay} onChange={setAutoplay} label="Tự phát bài tương tự" />}
        />
        <SettingsRow label="Hẹn giờ tắt" detail="Dừng nhạc sau một khoảng thời gian" onClick={openSleepTimer} />
      </Section>

      {__WEB_APP__ ? (
        <Section title="Nguồn nhạc">
          <WebSources />
        </Section>
      ) : (
        <>
          <Section title="YouTube (Gmail)">
            <Suspense fallback={<div className="h-[60px]" />}>
              <GoogleSection />
            </Suspense>
          </Section>
          <Section title="Spotify">
            <Suspense fallback={<div className="h-[60px]" />}>
              <SpotifySection />
            </Suspense>
          </Section>
        </>
      )}

      <Section title="Tải về">
        <SettingsRow label="Đã tải" detail={`${doneCount} bài • ${formatBytes(totalDownloadedBytes(rows.values()))}`} onClick={() => navigate({ name: 'downloads' })} />
        <SettingsRow
          label="Số bài tải cùng lúc"
          detail={
            downloadSettings.concurrency === 'auto'
              ? `Tự động 1–15 theo tốc độ mạng (4G/5G tối đa ${CELLULAR_MAX})`
              : `Luôn ${downloadSettings.concurrency} bài (YouTube chặn thì tự giảm)`
          }
          right={
            <select
              className="rounded-md bg-white/10 px-2 py-1.5 text-[14px] outline-none"
              aria-label="Số bài tải cùng lúc"
              value={String(downloadSettings.concurrency)}
              onChange={(e) => {
                const value: ConcurrencySetting = e.target.value === 'auto' ? 'auto' : Number(e.target.value);
                void setDownloadSettings({ concurrency: value });
              }}
            >
              <option value="auto">Tự động</option>
              {[1, 2, 3, 5, 8, 10, 12, 15].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label="Tải bằng dữ liệu di động"
          detail="Tắt thì chỉ tải khi có Wi‑Fi"
          right={<Toggle checked={downloadSettings.cellular} onChange={(cellular) => void setDownloadSettings({ cellular })} label="Tải bằng dữ liệu di động" />}
        />
        <SettingsRow
          label="Tự tải bài hát đã thích"
          detail="Bấm ♡ là bài được tải về để nghe offline"
          right={<Toggle checked={downloadSettings.autoLiked} onChange={(autoLiked) => void setDownloadSettings({ autoLiked })} label="Tự tải bài hát đã thích" />}
        />
        {doneCount > 0 && (
          <SettingsRow label="Xoá tất cả bài đã tải" onClick={() => confirmAction('Xoá tất cả bài đã tải khỏi máy?', removeAllDownloads, 'Đã xoá tất cả bài đã tải')} />
        )}
      </Section>

      <Section title="Dữ liệu trên máy">
        <SettingsRow label="Xoá lịch sử nghe" onClick={() => confirmAction('Xoá toàn bộ lịch sử nghe?', clearHistory, 'Đã xoá lịch sử nghe')} />
        <SettingsRow label="Xoá lịch sử tìm kiếm" onClick={() => confirmAction('Xoá lịch sử tìm kiếm?', clearSearches, 'Đã xoá lịch sử tìm kiếm')} />
        <SettingsRow label="Xoá lời bài hát đã lưu" onClick={() => confirmAction('Xoá lời bài hát đã lưu?', () => db.lyrics.clear(), 'Đã xoá lời bài hát đã lưu')} />
      </Section>

      <Section title="Gỡ lỗi">
        <SettingsRow label="Nhật ký lỗi" detail="Copy gửi cho người sửa app khi có lỗi" onClick={() => navigate({ name: 'logs' })} />
      </Section>

      <Section title="Thông tin">
        <SettingsRow label="Phiên bản" detail={`Melo ${__APP_VERSION__}`} />
        <p className="px-4 pt-2 text-[12px] leading-relaxed text-subdued">
          {__WEB_APP__
            ? 'Bản web của Melo: nhạc từ Audius và Jamendo (giấy phép của từng nghệ sĩ) và file nhạc của bạn. Nhạc đã tải nằm trong trình duyệt trên máy này, không qua máy chủ nào.'
            : 'App dùng cá nhân, không phát hành trên App Store. Nhạc lấy từ YouTube Music ngay trên máy, không qua máy chủ nào.'}
        </p>
      </Section>
    </Page>
  );
}

const LEVEL_CLASS: Record<LogLevel, string> = { error: 'text-red-300', warn: 'text-yellow-200', info: 'text-white/80' };

export function LogsPage() {
  useSyncExternalStore(subscribeLogs, getLogVersion);
  const entries = getLogs();
  return (
    <Page
      title="Nhật ký"
      solidHeader
      right={
        <div className="flex gap-1">
          <button className="p-2" aria-label="Copy nhật ký" onClick={() => copyText(logsAsText(), 'Đã copy nhật ký', 'Không copy được, hãy chụp màn hình')}>
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
          <div key={`${e.time}-${i}`} className={`border-b border-white/5 py-1.5 ${LEVEL_CLASS[e.level]}`}>
            <span className="text-white/40">{new Date(e.time).toLocaleTimeString('vi-VN')}</span> [{e.tag}] {e.message}
          </div>
        ))}
      </div>
    </Page>
  );
}
