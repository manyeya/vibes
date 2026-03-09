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
    <div className={cn('mb-7 flex gap-4', isUser && 'flex-row-reverse')}>
      <Avatar type={isUser ? 'user' : 'bot'} size="md" />
      <div
        className={cn(
          'rounded-[1.5rem] border px-5 py-4 backdrop-blur-md',
          isUser ? 'max-w-[85%]' : 'max-w-[100%] flex-1',
          {
            'rounded-br-md border-[var(--user-bubble-line)] bg-[var(--user-bubble)] text-[var(--user-bubble-ink)]': isUser,
            'rounded-bl-md border-[var(--glass-border)] bg-[var(--assistant-bubble)] text-[var(--ink)]': !isUser,
          },
          className
        )}
        style={{ minWidth: isUser ? 'auto' : '0' }}
      >
        <div className="overflow-wrap-break-word min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
};
