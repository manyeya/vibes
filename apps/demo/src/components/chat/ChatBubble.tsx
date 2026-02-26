import { cn } from '../../lib/utils';
import { Avatar } from '../ui/Avatar';

interface ChatBubbleProps {
  role: 'user' | 'assistant' | 'system';
  children: React.ReactNode;
  className?: string;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ role, children, className }) => {
  const isUser = role === 'user';

  return (
    <div className={cn('flex gap-3 mb-6', isUser && 'flex-row-reverse')}>
      <Avatar type={isUser ? 'user' : 'bot'} size="md" />
      <div
        className={cn(
          'px-4 py-3 rounded-2xl',
          // Allow content to expand, but constrain width for user messages
          isUser ? 'max-w-[85%]' : 'max-w-[100%] flex-1',
          {
            'bg-gradient-to-r from-cyan-600 to-violet-600 text-white rounded-tr-sm': isUser,
            'bg-zinc-800/50 text-zinc-100 border border-zinc-700/50 rounded-tl-sm': !isUser,
          },
          className
        )}
        style={{ minWidth: isUser ? 'auto' : '0' }}
      >
        {/* Ensure content can expand properly */}
        <div className="overflow-wrap-break-word min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
};
