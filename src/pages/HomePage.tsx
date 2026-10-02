import { useQuery } from '@tanstack/react-query';
import { Settings } from 'lucide-react';
import { MixCard } from '@/components/MixCard';
import { TrackArtwork } from '@/components/TrackArtwork';
import { ErrorState, Page, RootTitle } from '@/components/Page';
import { Shelf } from '@/components/Shelf';
import { greeting } from '@/lib/format';
import { useRecentTracks } from '@/lib/library';
import { errorMessage } from '@/lib/log';
import { currentPeriods, getMixes } from '@/lib/recommend';
import { playTracks } from '@/player/controller';
import { navigate } from '@/ui/nav';
import { getHome, getUpNext } from '@/youtube/music';

function ShelfSkeleton() {
  return (
    <div className="mt-7 animate-pulse px-4">
      <div className="h-5 w-40 rounded bg-white/10" />
      <div className="mt-3 flex gap-3 overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="w-36 shrink-0">
            <div className="aspect-square w-36 rounded bg-white/10" />
            <div className="mt-2 h-3 w-28 rounded bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Bản web: lỗi của Jamendo đã viết sẵn tiếng Việt (ví dụ chưa nhập Client ID) → hiện nguyên văn + nút mở Cài đặt. */
function HomeError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const fallback = 'Không tải được trang chủ. Kiểm tra kết nối mạng.';
  if (!__WEB_APP__) return <ErrorState message={fallback} onRetry={onRetry} />;
  return (
    <>
      <ErrorState message={errorMessage(error, fallback)} onRetry={onRetry} />
      <button className="mx-auto -mt-4 block text-[14px] font-semibold text-accent" onClick={() => navigate({ name: 'settings' })}>
        Mở Cài đặt
      </button>
    </>
  );
}

/** "Dành cho bạn": mix tạo từ lịch sử nghe (xem lib/recommend.ts). Chưa nghe đủ thì chưa hiện. */
function ForYou() {
  // Đổi buổi (sáng → trưa…) thì tạo lại mix theo giờ; còn lại đọc bản đã lưu.
  const period = currentPeriods(new Date()).daylist;
  const mixes = useQuery({
    queryKey: ['mixes', period],
    queryFn: () => getMixes((seed) => getUpNext(seed.id)),
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000
  });
  if (!mixes.data?.length) return null;
  return (
    <section className="mt-7">
      <h2 className="px-4 text-[20px] font-bold leading-tight">Dành cho bạn</h2>
      <div className="no-scrollbar mt-3 flex snap-x gap-3 overflow-x-auto scroll-px-4 px-4">
        {mixes.data.map((mix) => (
          <div key={mix.id} className="snap-start">
            <MixCard mix={mix} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function HomePage() {
  const home = useQuery({ queryKey: ['home'], queryFn: getHome, staleTime: 30 * 60_000 });
  const recent = useRecentTracks(6);

  return (
    <Page>
      <RootTitle
        right={
          <button className="p-1 text-white/90 active:scale-90" aria-label="Cài đặt" onClick={() => navigate({ name: 'settings' })}>
            <Settings size={24} />
          </button>
        }
      >
        {greeting()}
      </RootTitle>

      {recent && recent.length > 0 && (
        <div className="grid grid-cols-2 gap-2 px-4 pt-2">
          {recent.map((track, i) => (
            <button
              key={track.id}
              className="flex h-14 items-center gap-2 overflow-hidden rounded bg-white/10 text-left active:bg-white/20"
              onClick={() => void playTracks(recent, i, { context: { type: 'other', title: 'Nghe gần đây' } })}
            >
              <TrackArtwork track={track} size={56} className="size-14 shrink-0 rounded-none" />
              <span className="line-clamp-2 pr-2 text-[13px] font-semibold leading-tight">{track.title}</span>
            </button>
          ))}
        </div>
      )}

      <ForYou />
      {home.isPending && [0, 1, 2].map((i) => <ShelfSkeleton key={i} />)}
      {home.isError && <HomeError error={home.error} onRetry={() => void home.refetch()} />}
      {home.data?.map((shelf) => <Shelf key={shelf.title} shelf={shelf} />)}
      {__WEB_APP__ && home.data && (
        <p className="px-4 pt-8 text-center text-[12px] text-subdued">
          Nhạc Creative Commons từ{' '}
          <a className="underline" href="https://www.jamendo.com" target="_blank" rel="noopener noreferrer">
            Jamendo
          </a>
        </p>
      )}
    </Page>
  );
}
