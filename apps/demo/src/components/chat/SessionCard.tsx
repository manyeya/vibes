import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { MessageSquare, X } from 'lucide-react';

interface SessionCardProps {
  id: string;
  title?: string;
  isActive: boolean;
  messageCount: number;
  onSelect: () => void;
  onDelete: () => void;
}

export const SessionCard: React.FC<SessionCardProps> = ({
  id,
  title,
  isActive,
  messageCount,
  onSelect,
  onDelete,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onSelect}
      className={cn(
        'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all',
        isActive
          ? 'bg-gradient-to-r from-cyan-500/10 to-violet-500/10 border border-cyan-500/30 shadow-lg shadow-cyan-500/5'
          : 'hover:bg-zinc-800/50 border border-transparent'
      )}
    >
      {isActive && <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-gradient-to-b from-cyan-400 to-violet-400 rounded-full" />}

      <MessageSquare className={cn('w-4 h-4 shrink-0', isActive ? 'text-cyan-400' : 'text-zinc-500')} />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate text-zinc-200">
          {title || 'Untitled Session'}
        </div>
        <div className="text-[10px] text-zinc-500">
          {messageCount} message{messageCount !== 1 ? 's' : ''}
        </div>
      </div>

      {id !== 'default' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-red-500/20 hover:text-red-400 text-zinc-600 transition-all"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </motion.div>
  );
};
