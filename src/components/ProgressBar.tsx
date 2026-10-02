/** Thanh tiến độ mảnh (tải bài, đồng bộ Spotify). `ratio` từ 0 tới 1. */
export function ProgressBar({ ratio, className = '' }: { ratio: number; className?: string }) {
  return (
    <div className={`h-1 rounded-full bg-white/15 ${className}`}>
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.min(1, Math.max(0, ratio)) * 100}%` }} />
    </div>
  );
}
