import { cn } from '../../lib/utils';
import { Bot, User } from 'lucide-react';

interface AvatarProps {
  type?: 'user' | 'bot' | 'custom';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({ type = 'bot', size = 'md', icon, className }) => {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md backdrop-blur-md',
        {
          'border border-[var(--glass-border)] bg-[var(--glass-light)]': type === 'user',
          'border border-[var(--glass-border)] bg-[var(--glass)]': type === 'bot',
          'border border-[color:color-mix(in_srgb,var(--accent)_28%,var(--glass-border))] bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--glass-light))]': type === 'custom',
        },
        {
          // Sizes
          'w-6 h-6': size === 'sm',
          'w-8 h-8': size === 'md',
          'w-10 h-10': size === 'lg',
        },
        className
      )}
    >
      {icon || (type === 'user' ? <User className="w-3.5 h-3.5 text-[var(--muted)]" /> : <Bot className="w-4 h-4 text-[var(--ink)]" />)}
    </div>
  );
};
