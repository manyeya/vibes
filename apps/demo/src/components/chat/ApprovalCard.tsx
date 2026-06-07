import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface ApprovalCardProps {
  toolName: string;
  args: any;
  approvalId: string;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

export const ApprovalCard = ({ toolName, args, approvalId, onApprove, onDeny }: ApprovalCardProps) => {
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'y' || e.key === 'Y') {
        onApprove(approvalId);
      } else if (e.key === 'n' || e.key === 'N') {
        onDeny(approvalId);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [approvalId, onApprove, onDeny]);

  const formatJson = (obj: any, maxChars = 500): string => {
    const jsonStr = JSON.stringify(obj, null, 2);
    if (jsonStr.length <= maxChars) return jsonStr;
    return jsonStr.slice(0, maxChars) + '\n... (truncated)';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="border border-amber-300 dark:border-amber-900/50 rounded-lg overflow-hidden bg-amber-50 dark:bg-amber-950/20"
    >
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-950/30 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <div>
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Permission Required</span>
            <Badge variant="amber" size="sm" className="ml-2">{toolName}</Badge>
          </div>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-zinc-500 dark:text-zinc-500 transition-transform", isExpanded && "rotate-180")} />
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-3">
              <pre className="text-xs text-zinc-700 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-900/50 p-3 rounded-md overflow-auto max-h-48 font-mono">
                {formatJson(args)}
              </pre>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => onDeny(approvalId)}
                >
                  Deny (N)
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => onApprove(approvalId)}
                >
                  Approve (Y)
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
