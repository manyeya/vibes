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
          'flex-1 border-none bg-transparent text-[15px] leading-7 text-[var(--ink)] outline-none placeholder:text-[var(--muted)]',
          'resize-none px-3 py-2 min-h-[56px] max-h-[220px] overflow-y-auto',
          'focus:outline-none focus:ring-0',
          'scrollbar-thin scrollbar-track-transparent',
          className
        )}
        value={value}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';
