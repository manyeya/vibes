import { motion } from 'framer-motion';
import { Avatar } from '../ui/Avatar';

export const TypingIndicator: React.FC = () => {
  return (
    <div className="flex gap-3 mb-6">
      <Avatar type="bot" size="md" />
      <div className="rounded-lg rounded-tl-sm border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-[var(--muted)]"
              animate={{ scale: [1, 1.3, 1], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
