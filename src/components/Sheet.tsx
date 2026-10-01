import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** chiếm gần hết màn hình (hàng chờ) thay vì vừa nội dung */
  tall?: boolean;
  label?: string;
}

const ANIMATION_MS = 260;

/** Bảng trượt từ dưới lên, vuốt xuống để đóng (kiểu iOS). */
export function Sheet({ open, onClose, children, tall = false, label }: Props) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; t: number } | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setDrag(0);
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;

  // Kéo ở phần tay nắm phía trên để đóng (phần nội dung vẫn cuộn bình thường).
  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, t: performance.now() };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    setDrag(Math.max(0, e.clientY - start.current.y));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dy = e.clientY - start.current.y;
    const velocity = dy / Math.max(1, performance.now() - start.current.t);
    start.current = null;
    setDragging(false);
    if (dy > 110 || (dy > 30 && velocity > 0.6)) onClose();
    else setDrag(0);
  };

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal aria-label={label}>
      <div
        className="absolute inset-0 bg-black/60 transition-opacity"
        style={{ opacity: shown ? 1 : 0, transitionDuration: `${ANIMATION_MS}ms` }}
        onClick={onClose}
      />
      <div
        className={`safe-bottom absolute inset-x-0 bottom-0 flex flex-col rounded-t-2xl bg-[#232323] shadow-2xl ${tall ? 'h-[88%]' : 'max-h-[85%]'}`}
        style={{
          transform: `translateY(${shown ? drag : window.innerHeight}px)`,
          transition: dragging ? 'none' : `transform ${ANIMATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`
        }}
      >
        <div
          className="flex shrink-0 touch-none justify-center pt-3 pb-3"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="h-1 w-10 rounded-full bg-white/30" />
        </div>
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Một dòng hành động trong bảng (menu của bài…). */
export function SheetItem({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`flex w-full items-center gap-4 px-5 py-3.5 text-left text-[15px] active:bg-white/10 ${danger ? 'text-red-400' : ''}`} onClick={onClick}>
      <span className="text-subdued">{icon}</span>
      {label}
    </button>
  );
}
