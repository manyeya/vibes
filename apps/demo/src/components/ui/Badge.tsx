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
        'inline-flex items-center gap-1.5 rounded-md font-medium',
        {
          'bg-sky-500/12 text-sky-700 dark:text-sky-300': variant === 'cyan',
          'bg-violet-500/12 text-violet-700 dark:text-violet-300': variant === 'violet',
          'bg-amber-500/12 text-amber-700 dark:text-amber-300': variant === 'amber',
          'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300': variant === 'emerald',
          'bg-red-500/12 text-red-700 dark:text-red-300': variant === 'red',
          'bg-[var(--surface-raised)] text-[var(--muted)]': variant === 'zinc',
        },
        {
          // Sizes
          'px-2 py-0.5 text-[10px]': size === 'sm',
          'px-2 py-0.5 text-xs': size === 'md',
        },
        className
      )}
    >
      {children}
    </span>
  );
};
