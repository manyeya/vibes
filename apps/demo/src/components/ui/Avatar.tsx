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
        'rounded-lg flex items-center justify-center shrink-0',
        {
          // User styling
          'bg-zinc-800': type === 'user',
          // Bot styling
          'bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/20': type === 'bot',
          // Custom styling
          'bg-zinc-700': type === 'custom',
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
      {icon || (type === 'user' ? <User className="w-3.5 h-3.5 text-zinc-400" /> : <Bot className="w-4 h-4 text-cyan-400" />)}
    </div>
  );
};
