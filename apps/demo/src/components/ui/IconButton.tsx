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
        'p-2 rounded-lg transition-all duration-150',
        'focus:outline-none focus:ring-2 focus:ring-cyan-500/50',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        {
          'hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-100': variant === 'ghost',
          'bg-zinc-800 text-zinc-100 hover:bg-zinc-700': variant === 'secondary',
        },
        className
      )}
      {...props}
    >
      {icon}
    </button>
  );
};
