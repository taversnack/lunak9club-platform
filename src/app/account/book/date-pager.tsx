'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import s from '@/ui/ui.module.css';
import b from './book.module.css';

/**
 * Shows the calendar two weeks at a time. Every page stays in the form (only `hidden`), so ticked dates on
 * other pages are still submitted. The range is announced politely when it changes.
 */
export function DatePager({ pages, labels }: { pages: ReactNode[]; labels: string[] }) {
  const [i, setI] = useState(0);
  const last = pages.length - 1;
  return (
    <div>
      <div className={b.pagerBar}>
        <button
          type="button"
          className={`${s.button} ${s.secondary} ${s.sm}`}
          onClick={() => setI((n) => Math.max(0, n - 1))}
          disabled={i === 0}
        >
          Previous 2 weeks
        </button>
        <p className={b.pagerLabel} aria-live="polite">
          {labels[i]}
        </p>
        <button
          type="button"
          className={`${s.button} ${s.secondary} ${s.sm}`}
          onClick={() => setI((n) => Math.min(last, n + 1))}
          disabled={i === last}
        >
          Next 2 weeks
        </button>
      </div>
      {pages.map((p, n) => (
        <div key={labels[n]} hidden={n !== i}>
          {p}
        </div>
      ))}
    </div>
  );
}

/** Submit bar that sticks to the bottom of the screen on mobile and shows how many days are ticked. */
export function StickySubmit() {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const update = () => setCount(form.querySelectorAll('input[name="date"]:checked').length);
    update();
    form.addEventListener('change', update);
    return () => form.removeEventListener('change', update);
  }, []);
  return (
    <div ref={ref} className={b.sticky}>
      <p className={b.stickyCount} aria-live="polite">
        {count === 0 ? 'No days chosen yet' : `${count} day${count === 1 ? '' : 's'} chosen`}
      </p>
      <button type="submit" className={`${s.button} ${s.primary}`}>
        Check price and availability
      </button>
    </div>
  );
}
