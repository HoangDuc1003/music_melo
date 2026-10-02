import { useLiveQuery } from 'dexie-react-hooks';
import { RotateCw, Trash2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { CollectionView } from '@/components/CollectionView';
import { Centered } from '@/components/Page';
import { ProgressBar } from '@/components/ProgressBar';
import { progressRatio, removeAllDownloads, removeDownload, retryDownload, totalDownloadedBytes, useDownloads } from '@/downloads/manager';
import { getTracks, type DownloadRow } from '@/lib/db';
import { formatBytes, joinArtists } from '@/lib/format';
import { useNetwork } from '@/lib/network';
import { confirmAction } from '@/ui/overlays';
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
  const ids = useMemo(
    () => [...rows.values()].sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt)).map((r) => r.id).join(','),
    [rows]
  );
  const tracks = useLiveQuery(() => getTracks(ids ? ids.split(',') : []), [ids]);
  const { done, pending } = useMemo(() => {
    const status = (t: Track) => rows.get(t.id)?.status ?? 'queued';
    const rank = (t: Track) => PENDING_ORDER[status(t)] ?? 1;
    return {
      done: (tracks ?? []).filter((t) => status(t) === 'done'),
      pending: (tracks ?? []).filter((t) => status(t) !== 'done').sort((a, b) => rank(a) - rank(b))
    };
  }, [tracks, rows]);
  if (!tracks) return null;
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
            onClick={() => confirmAction('Xoá tất cả bài đã tải khỏi máy?', removeAllDownloads, 'Đã xoá tất cả bài đã tải')}
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

/** Vì sao các bài đang chờ chưa được tải (undefined = không bị chặn). */
function useBlocked(): 'offline' | 'wifi' | undefined {
  const online = useNetwork((s) => s.online);
  const waitingForWifi = useDownloads((s) => s.waitingForWifi);
  if (!online) return 'offline';
  return waitingForWifi ? 'wifi' : undefined;
}

function DownloadStatusLine() {
  const blocked = useBlocked();
  const limit = useDownloads((s) => s.limit);
  const speed = useDownloads((s) => s.speed);
  const cooldown = useDownloads((s) => s.cooldown);
  const running = useDownloads((s) => {
    let n = 0;
    for (const row of s.rows.values()) if (row.status === 'downloading') n += 1;
    return n;
  });
  let text = `${Math.min(limit, running)}/${limit} lượt song song • ${formatBytes(speed)}/s`;
  if (blocked === 'offline') text = 'Chờ có mạng';
  else if (blocked === 'wifi') text = 'Chờ Wi‑Fi (đã tắt tải bằng dữ liệu di động)';
  else if (cooldown > 0) text = `YouTube đang hạn chế, tạm nghỉ ${Math.ceil(cooldown / 1000)} giây rồi tải tiếp`;
  return (
    <p className="px-4 pb-1 text-[12px] text-subdued" aria-live="polite">
      {text}
    </p>
  );
}

const PendingRow = memo(function PendingRow({ track, row }: { track: Track; row: DownloadRow }) {
  const p = useDownloads((s) => s.progress.get(track.id));
  const blocked = useBlocked();
  const ratio = progressRatio(p);
  let status = `${Math.round(ratio * 100)}% • ${formatBytes(p?.bytes ?? 0)}`;
  if (row.status === 'error') status = `Lỗi: ${row.error ?? 'không rõ'}`;
  else if (row.status === 'queued') status = blocked === 'offline' ? 'Chờ có mạng' : blocked === 'wifi' ? 'Chờ Wi‑Fi' : 'Đang chờ…';
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px]">{track.title}</div>
        <div className="truncate text-[12px] text-subdued">
          {status} • {joinArtists(track.artists)}
        </div>
        {row.status === 'downloading' && <ProgressBar ratio={ratio} className="mt-1" />}
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
