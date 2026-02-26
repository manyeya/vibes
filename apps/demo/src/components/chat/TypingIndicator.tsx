import { motion } from 'framer-motion';
import { Avatar } from '../ui/Avatar';

export const TypingIndicator: React.FC = () => {
  return (
    <div className="flex gap-3 mb-6">
      <Avatar type="bot" size="md" />
      <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-zinc-800/50 border border-zinc-700/50">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 bg-cyan-400 rounded-full"
              animate={{ scale: [1, 1.3, 1], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
