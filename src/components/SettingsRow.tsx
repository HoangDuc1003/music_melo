// Một dòng trong Cài đặt + công tắc bật/tắt (dùng chung cho Cài đặt, mục Spotify, hàng chờ).
import { ChevronRight } from 'lucide-react';

interface SettingsRowProps {
  label: string;
  detail?: string;
  onClick?: () => void;
  /** phần bên phải; mặc định là mũi tên khi bấm được */
  right?: React.ReactNode;
  danger?: boolean;
}

export function SettingsRow({ label, detail, onClick, right, danger }: SettingsRowProps) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/5" onClick={onClick}>
      <div className="min-w-0 flex-1">
        <div className={`text-[15px] ${danger ? 'text-red-400' : ''}`}>{label}</div>
        {detail && <div className="text-[12px] text-subdued">{detail}</div>}
      </div>
      {right ?? (onClick && <ChevronRight size={18} className="text-subdued" />)}
    </Tag>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label?: string }) {
  return <input type="checkbox" className="toggle" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />;
}
