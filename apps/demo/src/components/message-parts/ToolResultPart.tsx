import React from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ToolResultPartProps {
  toolName: string;
  isError: boolean;
}

export const ToolResultPart: React.FC<ToolResultPartProps> = ({ toolName, isError }) => {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs",
        isError
          ? "bg-red-500/10 border-red-500/20 text-red-400"
          : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
      )}
    >
      {isError ? <X className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
      <span className="font-mono">{toolName}</span>
    </div>
  );
};
