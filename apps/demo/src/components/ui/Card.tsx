import { cn } from '../../lib/utils';
import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  gradient?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, className, hover = false, gradient = false }) => {
  return (
    <div
      className={cn(
        'rounded-lg border transition-colors duration-150',
        {
          // Flat, professional card styling
          'bg-zinc-50 border-zinc-200 dark:bg-zinc-900/50 dark:border-zinc-800': !gradient,
          'bg-zinc-100 border-zinc-300 dark:bg-zinc-800/50 dark:border-zinc-700': gradient,
          'hover:bg-zinc-100 hover:border-zinc-300 dark:hover:bg-zinc-800/70 dark:hover:border-zinc-700': hover,
        },
        className
      )}
    >
      {children}
    </div>
  );
};
