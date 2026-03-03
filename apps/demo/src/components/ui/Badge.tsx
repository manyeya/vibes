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
          // Variants - more subtle, professional colors
          'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400': variant === 'cyan',
          'bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400': variant === 'violet',
          'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400': variant === 'amber',
          'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400': variant === 'emerald',
          'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400': variant === 'red',
          'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400': variant === 'zinc',
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
