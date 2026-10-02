import { memo } from 'react';
import { ArrowDown, CircleAlert } from 'lucide-react';
import { progressRatio, useDownloads } from '@/downloads/manager';

/** Biểu tượng nhỏ cạnh tên nghệ sĩ: đã tải (xanh), đang tải (vòng tiến độ), đang chờ, lỗi. */
export const DownloadBadge = memo(function DownloadBadge({ id }: { id: string }) {
  const status = useDownloads((s) => s.rows.get(id)?.status);
  const progress = useDownloads((s) => s.progress.get(id));
  if (!status) return null;
  if (status === 'error') return <CircleAlert size={14} className="mr-1 inline shrink-0 text-red-400" aria-label="Tải lỗi" />;
  if (status === 'done') {
    return (
      <span className="mr-1 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-accent align-[-2px]" aria-label="Đã tải">
        <ArrowDown size={10} strokeWidth={3.5} className="text-black" />
      </span>
    );
  }
  const ratio = progressRatio(progress);
  return (
    <span
      className="mr-1 inline-block size-3.5 shrink-0 rounded-full align-[-2px]"
      style={{ background: `conic-gradient(var(--color-accent) ${ratio * 360}deg, rgba(255,255,255,0.25) 0deg)` }}
      aria-label={status === 'queued' ? 'Đang chờ tải' : `Đang tải ${Math.round(ratio * 100)}%`}
    />
  );
});
