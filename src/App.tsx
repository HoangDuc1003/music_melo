// Bố cục chính kiểu Spotify: 3 tab (mỗi tab một ngăn xếp trang, giữ nguyên khi chuyển tab),
// trình phát mini + thanh tab ở dưới, trình phát toàn màn hình và các bảng trượt phủ lên trên.
import { Component, memo, useState, type ReactNode } from 'react';
import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import { FullPlayer } from '@/components/FullPlayer';
import { MiniPlayer } from '@/components/MiniPlayer';
import { ErrorState, PageContext } from '@/components/Page';
import { PlaylistPicker } from '@/components/PlaylistPicker';
import { SleepTimerSheet } from '@/components/SleepTimerSheet';
import { TabBar } from '@/components/TabBar';
import { Toasts } from '@/components/Toasts';
import { VideoStage } from '@/components/VideoStage';
import { TrackMenu } from '@/components/TrackMenu';
import { log } from '@/lib/log';
import { ArtistPage } from '@/pages/ArtistPage';
import { AlbumPage, HistoryPage, LikedPage, LocalPlaylistPage, MixPage, PlaylistPage } from '@/pages/CollectionPages';
import { HomePage } from '@/pages/HomePage';
import { LibraryPage } from '@/pages/LibraryPage';
import { SearchPage } from '@/pages/SearchPage';
import { DownloadsPage } from '@/pages/DownloadsPage';
import { LogsPage, SettingsPage } from '@/pages/SettingsPages';
import { useNetwork } from '@/lib/network';
import { useNav, type NavEntry, type Route, type Tab } from '@/ui/nav';

function renderRoute(route: Route): ReactNode {
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'search':
      return <SearchPage />;
    case 'library':
      return <LibraryPage />;
    case 'album':
      return <AlbumPage id={route.id} />;
    case 'artist':
      return <ArtistPage id={route.id} />;
    case 'playlist':
      return <PlaylistPage id={route.id} />;
    case 'localPlaylist':
      return <LocalPlaylistPage id={route.id} />;
    case 'mix':
      return <MixPage id={route.id} />;
    case 'liked':
      return <LikedPage />;
    case 'history':
      return <HistoryPage />;
    case 'downloads':
      return <DownloadsPage />;
    case 'settings':
      return <SettingsPage />;
    case 'logs':
      return <LogsPage />;
  }
}

/** Lỗi trong một trang không làm trắng cả app. */
class PageBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    log.error('ui', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="safe-top flex h-full items-center justify-center">
        <ErrorState message="Trang này bị lỗi. Chi tiết ở Cài đặt → Nhật ký." onRetry={() => this.setState({ error: undefined })} />
      </div>
    );
  }
}

/** Một trang trong ngăn xếp: chỉ trang trên cùng của tab đang mở được hiện, các trang khác giữ nguyên (cả vị trí cuộn). */
const StackPage = memo(function StackPage({ entry, tab, depth, visible }: { entry: NavEntry; tab: Tab; depth: number; visible: boolean }) {
  // Trang mới mở trượt vào từ bên phải (chỉ một lần; hiện lại khi đổi tab/quay lại thì không chạy lại).
  const [entering, setEntering] = useState(depth > 0);
  return (
    <div
      className={`absolute inset-0 bg-base ${entering ? 'page-enter' : ''}`}
      hidden={!visible}
      data-tab={tab}
      data-depth={depth}
      onAnimationEnd={(e) => e.target === e.currentTarget && setEntering(false)}
    >
      <PageContext.Provider value={{ tab, depth }}>
        <PageBoundary>{renderRoute(entry.route)}</PageBoundary>
      </PageContext.Provider>
    </div>
  );
});

export default function App() {
  const activeTab = useNav((s) => s.tab);
  const stacks = useNav((s) => s.stacks);
  const online = useNetwork((s) => s.online);

  return (
    <div className="flex h-full flex-col bg-base pt-[var(--video-h,0px)]">
      {__WEB_APP__ && <VideoStage />}
      <EdgeSwipeBack>
        {(Object.keys(stacks) as Tab[]).map((tab) =>
          stacks[tab].map((entry, i) => (
            <StackPage key={entry.key} entry={entry} tab={tab} depth={i} visible={tab === activeTab && i === stacks[tab].length - 1} />
          ))
        )}
      </EdgeSwipeBack>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30">
        <div className="pointer-events-auto bg-gradient-to-t from-black via-black/95 to-transparent pt-6">
          {!online && (
            <div className="mx-2 mb-2 rounded-md bg-highlight px-3 py-1.5 text-center text-[12px] text-subdued">
              Đang offline — chỉ phát được bài đã tải
            </div>
          )}
          <MiniPlayer />
          <TabBar />
        </div>
      </div>
      <FullPlayer />
      <TrackMenu />
      <PlaylistPicker />
      <SleepTimerSheet />
      <Toasts />
    </div>
  );
}
