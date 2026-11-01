'use client';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Moves keyboard and screen reader focus to a notice when it appears (e.g. after a redirect back
 * from a payment), so it is read out and the next Tab starts there. Server-rendered as a plain
 * wrapper with tabIndex -1; focus moves only after hydration.
 */
export function FocusOnShow({ children, testId }: { children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} data-testid={testId}>
      {children}
    </div>
  );
}
