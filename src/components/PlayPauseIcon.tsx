import { Pause, Play } from 'lucide-react';

/** Biểu tượng nút phát: vòng xoay khi đang tải bài, Tạm dừng khi đang phát, Phát khi đang dừng. */
export function PlayPauseIcon({ playing, buffering = false, size, dark = false }: { playing: boolean; buffering?: boolean; size: number; dark?: boolean }) {
  const color = dark ? 'black' : 'white';
  if (buffering && playing) {
    const spinner = dark ? 'border-[3px] border-black/20 border-t-black' : 'border-2 border-white/30 border-t-white';
    return <span className={`animate-spin rounded-full ${spinner}`} style={{ width: size * 0.85, height: size * 0.85 }} />;
  }
  if (playing) return <Pause size={size} fill={color} strokeWidth={0} />;
  // Tam giác Phát lệch trái về mặt thị giác: dịch phải một chút cho cân.
  return <Play size={size} fill={color} strokeWidth={0} style={{ marginLeft: Math.round(size / 12) }} />;
}
