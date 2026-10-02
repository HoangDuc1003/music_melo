import { useState } from 'react';
import { formatDuration } from '@/lib/format';
import { seekTo } from '@/player/controller';
import { useLivePosition } from '@/ui/hooks';

/** Thanh tua: kéo thì chỉ xem trước, thả tay mới tua (tránh gửi hàng loạt lệnh cho native). */
export function SeekBar({ duration }: { duration: number }) {
  // Vị trí cập nhật ~15 lần/giây: chỉ thanh tua vẽ lại, không phải cả trình phát.
  const position = useLivePosition();
  const [drag, setDrag] = useState<number>();
  const value = drag ?? position;
  const max = Math.max(duration, 1);
  const percent = Math.min(100, (value / max) * 100);

  const commit = () => {
    if (drag !== undefined) void seekTo(drag);
    setDrag(undefined);
  };

  return (
    <div>
      <input
        type="range"
        className="seek w-full"
        min={0}
        max={max}
        step={0.5}
        value={Math.min(value, max)}
        disabled={duration <= 0}
        aria-label="Tua"
        style={{ '--seek': `${percent}%` } as React.CSSProperties}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
      />
      <div className="mt-1 flex justify-between text-[12px] text-white/60 tabular-nums">
        <span>{formatDuration(value)}</span>
        <span>{duration > 0 ? `-${formatDuration(Math.max(0, duration - value))}` : '--:--'}</span>
      </div>
    </div>
  );
}
