'use client';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Moves focus to its content once, when it first renders: for an error alert that arrives with a page
 * (after a form submit), so keyboard and screen-reader users land on it instead of the page top.
 */
export function FocusOnMount({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} data-focus-on-mount="">
      {children}
    </div>
  );
}
