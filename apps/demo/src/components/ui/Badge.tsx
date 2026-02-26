import { cn } from '../../lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'cyan' | 'violet' | 'amber' | 'emerald' | 'red' | 'zinc';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'zinc', size = 'md', className }) => {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        {
          // Variants
          'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20': variant === 'cyan',
          'bg-violet-500/10 text-violet-400 border border-violet-500/20': variant === 'violet',
          'bg-amber-500/10 text-amber-400 border border-amber-500/20': variant === 'amber',
          'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20': variant === 'emerald',
          'bg-red-500/10 text-red-400 border border-red-500/20': variant === 'red',
          'bg-zinc-800 text-zinc-400 border border-zinc-700': variant === 'zinc',
        },
        {
          // Sizes
          'px-2 py-0.5 text-[10px]': size === 'sm',
          'px-2.5 py-1 text-xs': size === 'md',
        },
        className
      )}
    >
      {children}
    </span>
  );
};
