/** Ba cột nhảy như Spotify khi bài đang phát (đứng yên khi tạm dừng). */
export function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span className={`equalizer inline-flex h-3.5 items-end gap-[2px] ${playing ? 'is-playing' : ''}`} aria-label="Đang phát">
      <span />
      <span />
      <span />
    </span>
  );
}
