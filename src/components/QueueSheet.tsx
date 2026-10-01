import { useRef, useState } from 'react';
import { EllipsisVertical, GripVertical } from 'lucide-react';
import { joinArtists } from '@/lib/format';
import { move, setAutoplay, skipTo } from '@/player/controller';
import type { QueueEntry } from '@/player/queue';
import { usePlayer } from '@/player/store';
import { openTrackMenu } from '@/ui/overlays';
import { Artwork } from './Artwork';
import { Equalizer } from './Equalizer';
import { Sheet } from './Sheet';

const ROW_HEIGHT = 60;
/** Hàng chờ có thể rất dài (radio): chỉ vẽ một phần, đủ dùng. */
const MAX_VISIBLE = 150;

function QueueRow({ entry, onPlay, onMenu, handle }: { entry: QueueEntry; onPlay: () => void; onMenu: () => void; handle?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4" style={{ height: ROW_HEIGHT }}>
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onPlay}>
        <Artwork src={entry.track.thumbnail} size={44} className="size-11 shrink-0" />
        <div className="min-w-0">
          <div className="truncate text-[15px]">{entry.track.title}</div>
          <div className="truncate text-[13px] text-subdued">{joinArtists(entry.track.artists)}</div>
        </div>
      </button>
      <button className="p-2 text-subdued" aria-label="Tuỳ chọn" onClick={onMenu}>
        <EllipsisVertical size={18} />
      </button>
      {handle}
    </div>
  );
}

/** Hàng chờ: bài đang phát, các bài tiếp theo (kéo ở tay nắm để đổi thứ tự), bật/tắt tự phát bài tương tự. */
export function QueueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const entries = usePlayer((s) => s.entries);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const autoplay = usePlayer((s) => s.autoplay);
  const repeat = usePlayer((s) => s.repeat);
  const [dragFrom, setDragFrom] = useState<number>();
  const [dragOver, setDragOver] = useState<number>();
  const startY = useRef(0);

  const current = entries[index];
  const upcoming = entries.slice(index + 1, index + 1 + MAX_VISIBLE);
  const hidden = Math.max(0, entries.length - index - 1 - upcoming.length);

  // Thứ tự đang hiển thị khi kéo (xem trước chỗ thả).
  const order = upcoming.map((_, i) => i);
  if (dragFrom !== undefined && dragOver !== undefined && dragFrom !== dragOver) {
    const [moved] = order.splice(dragFrom, 1);
    order.splice(dragOver, 0, moved);
  }

  const onHandleDown = (i: number) => (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    setDragFrom(i);
    setDragOver(i);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (dragFrom === undefined) return;
    const offset = Math.round((e.clientY - startY.current) / ROW_HEIGHT);
    setDragOver(Math.min(upcoming.length - 1, Math.max(0, dragFrom + offset)));
  };
  const onHandleUp = () => {
    if (dragFrom !== undefined && dragOver !== undefined && dragFrom !== dragOver) {
      void move(index + 1 + dragFrom, index + 1 + dragOver, upcoming[dragFrom]?.uid);
    }
    setDragFrom(undefined);
    setDragOver(undefined);
  };

  return (
    <Sheet open={open} onClose={onClose} tall label="Hàng chờ">
      <div className="pb-6">
        {current && (
          <>
            <h3 className="px-4 pb-1 text-[16px] font-bold">Đang phát</h3>
            <div className="flex items-center gap-3 px-4" style={{ height: ROW_HEIGHT }}>
              <Artwork src={current.track.thumbnail} size={44} className="size-11 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] text-accent">{current.track.title}</div>
                <div className="truncate text-[13px] text-subdued">{joinArtists(current.track.artists)}</div>
              </div>
              <Equalizer playing={playing} />
            </div>
          </>
        )}

        <div className="mt-4 flex items-center justify-between px-4 pb-1">
          <h3 className="text-[16px] font-bold">Tiếp theo</h3>
          <span className="text-[13px] text-subdued">{entries.length - index - 1} bài</span>
        </div>
        {order.map((i) => {
          const entry = upcoming[i];
          const absolute = index + 1 + i;
          const isDragged = i === dragFrom;
          return (
            <div key={entry.uid} className={isDragged ? 'relative z-10 bg-white/10 shadow-lg' : ''}>
              <QueueRow
                entry={entry}
                onPlay={() => void skipTo(absolute)}
                onMenu={() => openTrackMenu({ track: entry.track, queueIndex: absolute, queueUid: entry.uid })}
                handle={
                  <button
                    className="touch-none p-2 text-subdued"
                    aria-label="Kéo để đổi thứ tự"
                    onPointerDown={onHandleDown(i)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    onPointerCancel={onHandleUp}
                  >
                    <GripVertical size={20} />
                  </button>
                }
              />
            </div>
          );
        })}
        {hidden > 0 && <p className="px-4 py-3 text-[13px] text-subdued">và {hidden} bài nữa</p>}
        {!upcoming.length && <p className="px-4 py-3 text-[14px] text-subdued">Không còn bài nào trong hàng chờ.</p>}

        <label className="mt-4 flex items-center justify-between gap-4 border-t border-white/10 px-4 pt-4">
          <div>
            <div className="text-[15px]">Tự phát bài tương tự</div>
            <div className="text-[12px] text-subdued">
              {repeat === 'off' ? 'Hết hàng chờ thì phát tiếp radio' : 'Đang lặp lại nên không tự nối thêm'}
            </div>
          </div>
          <input type="checkbox" className="toggle" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} />
        </label>
      </div>
    </Sheet>
  );
}
