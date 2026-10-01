import { useLiveQuery } from 'dexie-react-hooks';
import { RotateCw, Trash2 } from 'lucide-react';
import { CollectionView } from '@/components/CollectionView';
import { Centered } from '@/components/Page';
import { removeAllDownloads, removeDownload, retryDownload, totalDownloadedBytes, useDownloads } from '@/downloads/manager';
import { db } from '@/lib/db';
import { formatBytes, joinArtists } from '@/lib/format';
import { useNetwork } from '@/lib/network';
import { toast } from '@/ui/overlays';
import type { Track } from '@/youtube/types';

/** Bài đã tải (nghe offline) + các bài đang tải / lỗi. */
export function DownloadsPage() {
  const rows = useDownloads((s) => s.rows);
  const progress = useDownloads((s) => s.progress);
  const online = useNetwork((s) => s.online);
  const limit = useDownloads((s) => s.limit);
  const speed = useDownloads((s) => s.speed);
  const cooldown = useDownloads((s) => s.cooldown);
  const waitingForWifi = useDownloads((s) => s.waitingForWifi);
  const ids = [...rows.values()].sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt)).map((r) => r.id);
  const tracks = useLiveQuery(async () => (await db.tracks.bulkGet(ids)).filter((t): t is Track => Boolean(t)), [ids.join(',')]);
  if (!tracks) return null;

  const done = tracks.filter((t) => rows.get(t.id)?.status === 'done');
  const pending = tracks.filter((t) => rows.get(t.id)?.status !== 'done');
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
          <p className="px-4 pb-1 text-[12px] text-subdued" aria-live="polite">
            {!online
              ? 'Chờ có mạng'
              : waitingForWifi
                ? 'Chờ Wi‑Fi (đã tắt tải bằng dữ liệu di động)'
                : cooldown > 0
                  ? `YouTube đang hạn chế, tạm nghỉ ${Math.ceil(cooldown / 1000)} giây rồi tải tiếp`
                  : `${Math.min(limit, pending.filter((t) => rows.get(t.id)?.status === 'downloading').length)}/${limit} lượt song song • ${formatBytes(speed)}/s`}
          </p>
          {pending.map((track) => {
            const row = rows.get(track.id)!;
            const p = progress.get(track.id);
            const ratio = p && p.total > 0 ? p.bytes / p.total : 0;
            return (
              <div key={track.id} className="flex items-center gap-3 px-4 py-2">
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
          })}
        </section>
      )}
    </CollectionView>
  );
}
