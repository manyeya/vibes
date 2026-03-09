import React from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-medium transition-all duration-300',
          'focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:ring-offset-2 focus:ring-offset-transparent',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          {
            'border border-[color:color-mix(in_srgb,var(--accent)_28%,var(--glass-border))] bg-[linear-gradient(135deg,var(--accent)_0%,color-mix(in_srgb,var(--tertiary)_72%,var(--accent))_100%)] text-white hover:scale-[1.02] hover:border-[var(--accent-strong)] hover:brightness-110': variant === 'primary',
            'border border-[var(--glass-border)] bg-[var(--glass)] text-[var(--ink)] backdrop-blur-md hover:border-[var(--glass-border-hover)] hover:bg-[var(--glass-light)]': variant === 'secondary',
            'bg-transparent text-[var(--muted)] hover:bg-[var(--glass)] hover:text-[var(--ink)]': variant === 'ghost',
            'border border-red-500/20 bg-red-500/10 text-[var(--danger)] hover:bg-red-500/16': variant === 'danger',
          },
          {
            // Sizes - more restrained rounding
            'px-3 py-1.5 text-sm rounded-md': size === 'sm',
            'px-3 py-2 text-sm rounded-md': size === 'md',
            'px-4 py-2.5 text-sm rounded-md': size === 'lg',
          },
          className
        )}
        {...props}
      >
        {isLoading && (
          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
