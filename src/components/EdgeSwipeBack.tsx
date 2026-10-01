import { useRef, type ReactNode } from 'react';
import { back, useNav } from '@/ui/nav';

const DURATION = 220;

interface Drag {
  x: number;
  y: number;
  t: number;
  active: boolean;
  top?: HTMLElement | null;
  under?: HTMLElement | null;
}

/**
 * Vuốt từ mép trái để quay lại như ứng dụng iOS: trang hiện tại đi theo ngón tay, trang trước lộ ra bên dưới.
 * Một dải mỏng ở mép trái (touch-action: none) nhận cử chỉ; chạm nhẹ thì chuyển tiếp cú chạm xuống phần tử bên dưới.
 * Style của 2 trang được chỉnh trực tiếp trong lúc kéo (không render lại React mỗi khung hình).
 */
export function EdgeSwipeBack({ children }: { children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const drag = useRef<Drag | null>(null);
  const canBack = useNav((s) => s.stacks[s.tab].length > 1);

  const clear = (...els: (HTMLElement | null | undefined)[]) => {
    for (const el of els) {
      if (!el) continue;
      el.style.transform = el.style.transition = el.style.boxShadow = el.style.filter = el.style.zIndex = '';
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), active: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const container = root.current;
    if (!d || !container) return;
    const dx = e.clientX - d.x;
    if (!d.active) {
      if (dx < 10) return;
      const { tab, stacks } = useNav.getState();
      const depth = stacks[tab].length - 1;
      d.top = container.querySelector<HTMLElement>(`[data-tab="${tab}"][data-depth="${depth}"]`);
      d.under = container.querySelector<HTMLElement>(`[data-tab="${tab}"][data-depth="${depth - 1}"]`);
      if (!d.top || !d.under) return;
      d.active = true;
      d.under.hidden = false;
      d.under.style.filter = 'brightness(0.6)';
      d.top.style.zIndex = '1';
      d.top.style.boxShadow = '-12px 0 24px rgba(0,0,0,0.45)';
      d.top.style.transition = d.under.style.transition = 'none';
    }
    const width = container.clientWidth;
    const x = Math.max(0, dx);
    d.top!.style.transform = `translateX(${x}px)`;
    d.under!.style.transform = `translateX(${-30 + (30 * x) / width}%)`;
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.active) {
      // Chạm nhẹ vào dải mép: chuyển cú chạm cho phần tử bên dưới (ví dụ nút quay lại).
      if (!cancelled && Math.abs(e.clientX - d.x) < 8 && Math.abs(e.clientY - d.y) < 8) {
        const strip = e.currentTarget;
        strip.style.pointerEvents = 'none';
        const below = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        strip.style.pointerEvents = '';
        below?.click();
      }
      return;
    }
    const { top, under } = d;
    const width = root.current?.clientWidth ?? window.innerWidth;
    const dx = e.clientX - d.x;
    const velocity = dx / Math.max(1, performance.now() - d.t);
    const commit = !cancelled && (dx > width * 0.35 || velocity > 0.5);
    const easing = `transform ${DURATION}ms cubic-bezier(0.32, 0.72, 0, 1)`;
    top!.style.transition = under!.style.transition = easing;
    top!.style.transform = commit ? `translateX(${width}px)` : 'translateX(0)';
    under!.style.transform = commit ? 'translateX(0)' : 'translateX(-30%)';
    window.setTimeout(() => {
      clear(top, under);
      if (commit) back();
      else under!.hidden = true;
    }, DURATION);
  };

  return (
    <main ref={root} className="relative min-h-0 flex-1 overflow-hidden">
      {children}
      {canBack && (
        <div
          className="absolute inset-y-0 left-0 z-10 w-3 touch-none"
          aria-hidden
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => finish(e, false)}
          onPointerCancel={(e) => finish(e, true)}
        />
      )}
    </main>
  );
}
