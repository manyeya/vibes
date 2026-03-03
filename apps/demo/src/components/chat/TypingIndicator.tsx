import { motion } from 'framer-motion';
import { Avatar } from '../ui/Avatar';

export const TypingIndicator: React.FC = () => {
  return (
    <div className="flex gap-3 mb-6">
      <Avatar type="bot" size="md" />
      <div className="px-4 py-2.5 rounded-lg rounded-tl-sm bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-600 rounded-full"
              animate={{ scale: [1, 1.3, 1], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
