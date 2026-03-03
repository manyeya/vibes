import { cn } from '../../lib/utils';
import { ReactNode } from 'react';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label?: string;
  variant?: 'ghost' | 'secondary';
}

export const IconButton: React.FC<IconButtonProps> = ({ icon, label, variant = 'ghost', className, ...props }) => {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'p-2 rounded-md transition-colors duration-150',
        'focus:outline-none focus:ring-1 focus:ring-zinc-300 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-zinc-600 dark:focus:ring-offset-zinc-950',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        {
          'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100': variant === 'ghost',
          'bg-zinc-200 text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600': variant === 'secondary',
        },
        className
      )}
      {...props}
    >
      {icon}
    </button>
  );
};
