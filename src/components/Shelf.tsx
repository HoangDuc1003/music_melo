import { playTracks } from '@/player/controller';
import { tracksOf } from '@/youtube/normalize';
import type { Shelf as ShelfData } from '@/youtube/types';
import { MediaCard, TrackCard } from './MediaCard';

/** Một hàng gợi ý cuộn ngang (trang chủ, nghệ sĩ). */
export function Shelf({ shelf }: { shelf: ShelfData }) {
  const tracks = tracksOf(shelf.items);
  if (!shelf.items.length) return null;
  return (
    <section className="mt-7">
      <h2 className="px-4 text-[20px] font-bold leading-tight">{shelf.title}</h2>
      <div className="no-scrollbar mt-3 flex snap-x gap-3 overflow-x-auto scroll-px-4 px-4">
        {shelf.items.map((item) =>
          item.type === 'card' ? (
            <div key={`c-${item.card.kind}-${item.card.id}`} className="snap-start">
              <MediaCard card={item.card} />
            </div>
          ) : (
            <div key={`t-${item.track.id}`} className="snap-start">
              <TrackCard
                track={item.track}
                onPlay={() => void playTracks(tracks, tracks.indexOf(item.track), { context: { type: 'other', title: shelf.title } })}
              />
            </div>
          )
        )}
      </div>
    </section>
  );
}
