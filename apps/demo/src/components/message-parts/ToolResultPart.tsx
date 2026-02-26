import React from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { Badge } from '../ui/Badge';

interface ToolResultPartProps {
  toolName: string;
  isError: boolean;
}

export const ToolResultPart: React.FC<ToolResultPartProps> = ({ toolName, isError }) => {
  return (
    <div className="flex items-center gap-2">
      {isError ? (
        <Badge variant="red" size="sm">
          <X className="w-3 h-3" />
          <span className="font-mono">{toolName}</span>
        </Badge>
      ) : (
        <Badge variant="emerald" size="sm">
          <CheckCircle2 className="w-3 h-3" />
          <span className="font-mono">{toolName}</span>
        </Badge>
      )}
    </div>
  );
};
