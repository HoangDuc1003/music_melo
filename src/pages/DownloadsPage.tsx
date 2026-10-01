import { useLiveQuery } from 'dexie-react-hooks';
import { RotateCw, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { CollectionView } from '@/components/CollectionView';
import { Centered } from '@/components/Page';
import { removeAllDownloads, removeDownload, retryDownload, totalDownloadedBytes, useDownloads } from '@/downloads/manager';
import { db, type DownloadRow } from '@/lib/db';
import { formatBytes, joinArtists } from '@/lib/format';
import { useNetwork } from '@/lib/network';
import { toast } from '@/ui/overlays';
import type { Track } from '@/youtube/types';

/** Bài đang tải lên đầu (thấy ngay thanh tiến độ), rồi bài đang chờ, bài lỗi ở cuối. */
const PENDING_ORDER: Record<string, number> = { downloading: 0, queued: 1, error: 2 };

/**
 * Bài đã tải (nghe offline) + các bài đang tải / lỗi.
 * Trang luôn được giữ trong cây (ẩn bằng `hidden`): tiến độ và tốc độ đổi liên tục nên chỉ các ô nhỏ bên dưới
 * theo dõi chúng, danh sách bài đã tải không phải vẽ lại mỗi lần.
 */
export function DownloadsPage() {
  const rows = useDownloads((s) => s.rows);
  const online = useNetwork((s) => s.online);
  const ids = [...rows.values()].sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt)).map((r) => r.id);
  const tracks = useLiveQuery(async () => (await db.tracks.bulkGet(ids)).filter((t): t is Track => Boolean(t)), [ids.join(',')]);
  if (!tracks) return null;

  const done = tracks.filter((t) => rows.get(t.id)?.status === 'done');
  const rank = (t: Track) => PENDING_ORDER[rows.get(t.id)?.status ?? 'queued'] ?? 1;
  const pending = tracks.filter((t) => rows.get(t.id)?.status !== 'done').sort((a, b) => rank(a) - rank(b));
  const used = totalDownloadedBytes(rows.values());

  return (
    <CollectionView
      title="Đã tải"
      subtitle={`${formatBytes(used)} trên máy${online ? '' : ' • đang offline'}`}
      tracks={done}
      context={{ type: 'library', id: 'downloads', title: 'Đã tải' }}
      hideDownload
      cover={
        <div className="flex aspect-square w-[62%] max-w-72 items-center justify-center rounded bg-gradient-to-br from-emerald-800 to-emerald-400 text-[64px] shadow-2xl">
          ⬇
        </div>
      }
      actions={
        done.length > 0 && (
          <button
            className="p-2 text-subdued active:scale-90"
            aria-label="Xoá tất cả bài đã tải"
            onClick={() => window.confirm('Xoá tất cả bài đã tải khỏi máy?') && void removeAllDownloads().then(() => toast('Đã xoá tất cả'))}
          >
            <Trash2 size={24} />
          </button>
        )
      }
      empty={
        !pending.length && <Centered>Chưa có bài nào. Bấm ⬇ ở album/playlist hoặc “Tải về” trong menu ⋮ của bài hát.</Centered>
      }
    >
      {pending.length > 0 && (
        <section className="pb-4">
          <h2 className="px-4 pt-2 text-[17px] font-bold">Đang tải ({pending.length})</h2>
          <DownloadStatusLine />
          {pending.map((track) => (
            <PendingRow key={track.id} track={track} row={rows.get(track.id)!} />
          ))}
        </section>
      )}
    </CollectionView>
  );
}

function DownloadStatusLine() {
  const online = useNetwork((s) => s.online);
  const limit = useDownloads((s) => s.limit);
  const speed = useDownloads((s) => s.speed);
  const cooldown = useDownloads((s) => s.cooldown);
  const waitingForWifi = useDownloads((s) => s.waitingForWifi);
  const running = useDownloads((s) => {
    let n = 0;
    for (const row of s.rows.values()) if (row.status === 'downloading') n += 1;
    return n;
  });
  return (
    <p className="px-4 pb-1 text-[12px] text-subdued" aria-live="polite">
      {!online
        ? 'Chờ có mạng'
        : waitingForWifi
          ? 'Chờ Wi‑Fi (đã tắt tải bằng dữ liệu di động)'
          : cooldown > 0
            ? `YouTube đang hạn chế, tạm nghỉ ${Math.ceil(cooldown / 1000)} giây rồi tải tiếp`
            : `${Math.min(limit, running)}/${limit} lượt song song • ${formatBytes(speed)}/s`}
    </p>
  );
}

const PendingRow = memo(function PendingRow({ track, row }: { track: Track; row: DownloadRow }) {
  const p = useDownloads((s) => s.progress.get(track.id));
  const online = useNetwork((s) => s.online);
  const waitingForWifi = useDownloads((s) => s.waitingForWifi);
  const ratio = p && p.total > 0 ? p.bytes / p.total : 0;
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px]">{track.title}</div>
        <div className="truncate text-[12px] text-subdued">
          {row.status === 'error'
            ? `Lỗi: ${row.error ?? 'không rõ'}`
            : row.status === 'queued'
              ? online && !waitingForWifi
                ? 'Đang chờ…'
                : waitingForWifi
                  ? 'Chờ Wi‑Fi'
                  : 'Chờ có mạng'
              : `${Math.round(ratio * 100)}% • ${formatBytes(p?.bytes ?? 0)}`}
          {' • '}
          {joinArtists(track.artists)}
        </div>
        {row.status === 'downloading' && (
          <div className="mt-1 h-1 rounded-full bg-white/15">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${ratio * 100}%` }} />
          </div>
        )}
      </div>
      {row.status === 'error' && (
        <button className="p-2 text-subdued" aria-label="Thử lại" onClick={() => void retryDownload(track.id)}>
          <RotateCw size={18} />
        </button>
      )}
      <button className="p-2 text-subdued" aria-label="Huỷ" onClick={() => void removeDownload(track.id)}>
        <Trash2 size={18} />
      </button>
    </div>
  );
});
