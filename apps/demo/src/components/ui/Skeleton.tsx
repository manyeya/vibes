import { cn } from '../../lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circle' | 'rectangle';
  width?: string;
  height?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className, variant = 'rectangle', width, height, ...props }) => {
  return (
    <div
      className={cn(
        'animate-pulse bg-zinc-800/50 rounded',
        {
          'rounded-full': variant === 'circle',
          'h-4 w-24': variant === 'text',
        },
        className
      )}
      style={{ width, height }}
      {...props}
    />
  );
};
