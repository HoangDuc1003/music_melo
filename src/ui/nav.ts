// Điều hướng kiểu Spotify: mỗi tab có một ngăn xếp trang riêng; bấm lại tab đang mở thì về trang gốc.
// Không dùng router URL vì app chạy trong WebView và cần giữ nguyên trạng thái/cuộn của từng tab.
import { create } from 'zustand';
import type { Card } from '@/youtube/types';

export type Tab = 'home' | 'search' | 'library';

export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'library' }
  | { name: 'album'; id: string }
  | { name: 'artist'; id: string }
  | { name: 'playlist'; id: string }
  | { name: 'localPlaylist'; id: number }
  | { name: 'liked' }
  | { name: 'history' }
  | { name: 'downloads' }
  | { name: 'settings' }
  | { name: 'logs' };

export interface NavEntry {
  key: string;
  route: Route;
}

interface NavState {
  tab: Tab;
  stacks: Record<Tab, NavEntry[]>;
  /** tăng mỗi khi bấm lại tab đang mở (trang gốc cuộn lên đầu) */
  rootTap: number;
}

/** Ngăn xếp sâu quá thì bỏ bớt trang cũ ở giữa để đỡ tốn bộ nhớ. */
const MAX_DEPTH = 12;

let keyCounter = 0;
const entry = (route: Route): NavEntry => ({ key: `${route.name}-${++keyCounter}`, route });

const roots = (): Record<Tab, NavEntry[]> => ({
  home: [entry({ name: 'home' })],
  search: [entry({ name: 'search' })],
  library: [entry({ name: 'library' })]
});

export const useNav = create<NavState>(() => ({ tab: 'home', stacks: roots(), rootTap: 0 }));

function sameRoute(a: Route, b: Route): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function navigate(route: Route) {
  const { tab, stacks } = useNav.getState();
  const stack = stacks[tab];
  if (sameRoute(stack[stack.length - 1].route, route)) return;
  let next = [...stack, entry(route)];
  if (next.length > MAX_DEPTH) next = [next[0], ...next.slice(next.length - MAX_DEPTH + 1)];
  useNav.setState({ stacks: { ...stacks, [tab]: next } });
}

export function back() {
  const { tab, stacks } = useNav.getState();
  const stack = stacks[tab];
  if (stack.length <= 1) return;
  useNav.setState({ stacks: { ...stacks, [tab]: stack.slice(0, -1) } });
}

export function selectTab(tab: Tab) {
  const state = useNav.getState();
  if (state.tab !== tab) {
    useNav.setState({ tab });
    return;
  }
  const stack = state.stacks[tab];
  useNav.setState({
    stacks: stack.length > 1 ? { ...state.stacks, [tab]: stack.slice(0, 1) } : state.stacks,
    rootTap: state.rootTap + 1
  });
}

/** Mở album/playlist/nghệ sĩ từ một thẻ. */
export function openCard(card: Pick<Card, 'kind' | 'id'>) {
  navigate({ name: card.kind, id: card.id } as Route);
}

export function canGoBack(state: NavState = useNav.getState()): boolean {
  return state.stacks[state.tab].length > 1;
}

