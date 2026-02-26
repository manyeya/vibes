import { cn } from '../../lib/utils';

interface DividerProps {
  label?: string;
  className?: string;
}

export const Divider: React.FC<DividerProps> = ({ label, className }) => {
  return (
    <div className={cn('flex items-center gap-4 my-4', className)}>
      <div className="flex-1 h-px bg-zinc-800" />
      {label && <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>}
      <div className="flex-1 h-px bg-zinc-800" />
    </div>
  );
};
