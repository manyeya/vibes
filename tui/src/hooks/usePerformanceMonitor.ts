import { useEffect, useRef } from 'react';

const SLOW_RENDER_MS = 16;

export function usePerformanceMonitor() {
  const lastRenderTime = useRef<number>(0);

  useEffect(() => {
    const renderStart = performance.now();
    
    return () => {
      const renderDuration = performance.now() - renderStart;
      if (renderDuration > SLOW_RENDER_MS) {
        console.warn(`Slow render detected: ${renderDuration.toFixed(2)}ms`);
      }
    };
  }, []);
}
