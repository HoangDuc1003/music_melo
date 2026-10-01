// Bố cục chính kiểu Spotify: 3 tab (mỗi tab một ngăn xếp trang, giữ nguyên khi chuyển tab),
// trình phát mini + thanh tab ở dưới, trình phát toàn màn hình và các bảng trượt phủ lên trên.
import { Component, memo, type ReactNode } from 'react';
import { FullPlayer } from '@/components/FullPlayer';
import { MiniPlayer } from '@/components/MiniPlayer';
import { PageContext } from '@/components/Page';
import { PlaylistPicker } from '@/components/PlaylistPicker';
import { SleepTimerSheet } from '@/components/SleepTimerSheet';
import { TabBar } from '@/components/TabBar';
import { Toasts } from '@/components/Toasts';
import { TrackMenu } from '@/components/TrackMenu';
import { log } from '@/lib/log';
import { ArtistPage } from '@/pages/ArtistPage';
import { AlbumPage, HistoryPage, LikedPage, LocalPlaylistPage, PlaylistPage } from '@/pages/CollectionPages';
import { HomePage } from '@/pages/HomePage';
import { LibraryPage } from '@/pages/LibraryPage';
import { SearchPage } from '@/pages/SearchPage';
import { DownloadsPage, LogsPage, SettingsPage } from '@/pages/SettingsPages';
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
      <div className="safe-top flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-subdued">
        <p>Trang này bị lỗi. Chi tiết ở Cài đặt → Nhật ký.</p>
        <button className="rounded-full border border-white/40 px-5 py-2 text-sm font-semibold text-white" onClick={() => this.setState({ error: undefined })}>
          Thử lại
        </button>
      </div>
    );
  }
}

/** Một trang trong ngăn xếp: chỉ trang trên cùng của tab đang mở được hiện, các trang khác giữ nguyên (cả vị trí cuộn). */
const StackPage = memo(function StackPage({ entry, tab, depth, visible }: { entry: NavEntry; tab: Tab; depth: number; visible: boolean }) {
  return (
    <div className="absolute inset-0" hidden={!visible}>
      <PageContext.Provider value={{ tab, depth }}>
        <PageBoundary>{renderRoute(entry.route)}</PageBoundary>
      </PageContext.Provider>
    </div>
  );
});

export default function App() {
  const activeTab = useNav((s) => s.tab);
  const stacks = useNav((s) => s.stacks);

  return (
    <div className="flex h-full flex-col bg-base">
      <main className="relative min-h-0 flex-1">
        {(Object.keys(stacks) as Tab[]).map((tab) =>
          stacks[tab].map((entry, i) => (
            <StackPage key={entry.key} entry={entry} tab={tab} depth={i} visible={tab === activeTab && i === stacks[tab].length - 1} />
          ))
        )}
      </main>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30">
        <div className="pointer-events-auto bg-gradient-to-t from-black via-black/95 to-transparent pt-6">
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
