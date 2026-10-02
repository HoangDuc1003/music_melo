import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { back, useNav, type Tab } from '@/ui/nav';
import { useScrollTop } from '@/ui/hooks';

export const PageContext = createContext<{ tab: Tab; depth: number }>({ tab: 'home', depth: 0 });

interface Props {
  /** tiêu đề hiện ở thanh trên cùng khi đã cuộn qua phần đầu trang */
  title?: string;
  /** màu nền phía trên (theo ảnh bìa) */
  color?: string;
  /** luôn hiện tiêu đề (trang không có phần đầu lớn) */
  solidHeader?: boolean;
  right?: ReactNode;
  children: ReactNode;
}

/** Khung một trang: vùng cuộn riêng (giữ vị trí khi quay lại), thanh trên cùng có nút quay lại. */
export function Page({ title, color, solidHeader = false, right, children }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const top = useScrollTop(scroller);
  const { tab, depth } = useContext(PageContext);
  const rootTap = useNav((s) => s.rootTap);
  const activeTab = useNav((s) => s.tab);

  useEffect(() => {
    // Bấm lại tab đang mở: trang gốc cuộn lên đầu.
    if (depth === 0 && tab === activeTab && rootTap > 0) scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootTap]);

  const progress = solidHeader ? 1 : Math.min(1, Math.max(0, (top - 160) / 80));
  const hasHeaderBar = depth > 0 || Boolean(title) || Boolean(right);

  return (
    <div ref={scroller} className="no-scrollbar relative h-full overflow-y-auto overscroll-y-contain">
      {color && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] transition-colors duration-500"
          style={{ background: `linear-gradient(to bottom, ${color}, transparent)` }}
        />
      )}
      {hasHeaderBar && (
        <header className="safe-top sticky top-0 z-20">
          <div
            className="absolute inset-0 transition-opacity"
            style={{ opacity: progress, background: color ? `color-mix(in srgb, ${color} 85%, #000)` : '#121212' }}
          />
          <div className="relative flex h-12 items-center gap-2 px-2">
            {depth > 0 ? (
              <button className="rounded-full bg-black/30 p-1.5 active:bg-black/50" aria-label="Quay lại" onClick={back}>
                <ChevronLeft size={24} />
              </button>
            ) : (
              <span className="w-2" />
            )}
            <div className="min-w-0 flex-1 truncate text-[16px] font-bold" style={{ opacity: progress }}>
              {title}
            </div>
            {right}
          </div>
        </header>
      )}
      <div className="relative pb-[calc(150px+env(safe-area-inset-bottom))]">{children}</div>
    </div>
  );
}

/** Tiêu đề lớn ở đầu các trang gốc (Trang chủ, Tìm kiếm, Thư viện). */
export function RootTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="safe-top">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="text-[26px] font-bold leading-tight">{children}</h1>
        {right}
      </div>
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <div className={`mx-auto size-7 animate-spin rounded-full border-2 border-white/20 border-t-white ${className}`} />;
}

export function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-8 text-center text-subdued">{children}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Centered>
      <p>{message}</p>
      {onRetry && (
        <button className="rounded-full border border-white/40 px-5 py-2 text-sm font-semibold text-white active:scale-95" onClick={onRetry}>
          Thử lại
        </button>
      )}
    </Centered>
  );
}

/** Cả trang đang tải. */
export function PageLoading() {
  return (
    <Page>
      <Spinner className="mt-40" />
    </Page>
  );
}

/** Cả trang không tải được (thường do mất mạng). */
export function PageError({ message = 'Không tải được. Kiểm tra kết nối mạng.', onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <Page solidHeader>
      <ErrorState message={message} onRetry={onRetry} />
    </Page>
  );
}
