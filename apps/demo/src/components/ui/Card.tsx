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
        'rounded-xl border transition-all duration-200',
        {
          'bg-zinc-900/50 border-zinc-800/50': !gradient,
          'bg-gradient-to-br from-cyan-500/10 to-violet-500/10 border-cyan-500/20': gradient,
          'hover:border-zinc-700 hover:bg-zinc-900/70': hover,
        },
        className
      )}
    >
      {children}
    </div>
  );
};
