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
        'rounded-lg border transition-all duration-300 backdrop-blur-md',
        {
          'bg-[var(--glass)] border-[var(--glass-border)]': !gradient,
          'bg-[var(--glass-light)] border-[var(--glass-border-hover)]': gradient,
          'hover:bg-[var(--glass-light)] hover:border-[var(--glass-border-hover)] hover:-translate-y-0.5': hover,
        },
        className
      )}
    >
      {children}
    </div>
  );
};
