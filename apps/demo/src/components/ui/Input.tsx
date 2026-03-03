import React, { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoResize?: boolean;
  maxLength?: number;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoResize = true, maxLength, value, ...props }, ref) => {
    const innerRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef = (ref || innerRef) as React.RefObject<HTMLTextAreaElement>;

    useEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea || !autoResize) return;

      const resize = () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
      };

      resize();
      textarea.addEventListener('input', resize);
      return () => textarea.removeEventListener('input', resize);
    }, [autoResize, textareaRef, value]);

    return (
      <textarea
        ref={textareaRef}
        maxLength={maxLength}
        className={cn(
          'flex-1 bg-transparent border-none outline-none text-sm placeholder:text-zinc-400 dark:placeholder:text-zinc-600',
          'resize-none px-3 py-2 min-h-[44px] max-h-[200px] overflow-y-auto',
          'focus:outline-none focus:ring-0',
          'scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent',
          className
        )}
        value={value}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';
