import { memo } from 'react';
import { joinArtists } from '@/lib/format';
import { openCard } from '@/ui/nav';
import type { Card, Track } from '@/youtube/types';
import { Artwork } from './Artwork';

/** Thẻ album / playlist / nghệ sĩ trong các hàng gợi ý. */
export const MediaCard = memo(function MediaCard({ card }: { card: Card }) {
  const round = card.kind === 'artist';
  return (
    <button className="w-36 shrink-0 text-left active:opacity-70" onClick={() => openCard(card)}>
      <Artwork src={card.thumbnail} round={round} className="aspect-square w-36" />
      <div className={`mt-2 line-clamp-2 text-[13px] font-medium leading-snug ${round ? 'text-center' : ''}`}>{card.title}</div>
      {card.subtitle && !round && <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-subdued">{card.subtitle}</div>}
    </button>
  );
});

/** Thẻ bài hát trong hàng gợi ý (bấm để phát cả hàng). */
export const TrackCard = memo(function TrackCard({ track, onPlay }: { track: Track; onPlay: () => void }) {
  return (
    <button className="w-36 shrink-0 text-left active:opacity-70" onClick={onPlay}>
      <Artwork src={track.thumbnail} className={`w-36 ${track.isVideo ? 'aspect-video' : 'aspect-square'}`} />
      <div className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug">{track.title}</div>
      <div className="mt-0.5 truncate text-[12px] text-subdued">{joinArtists(track.artists)}</div>
    </button>
  );
});
