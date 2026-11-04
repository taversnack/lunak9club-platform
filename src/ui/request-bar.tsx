'use client';
import { useEffect, useRef, useState } from 'react';
import s from './ui.module.css';

/**
 * Sticky bottom bar for the booking form: a live "2 days, 1 dog" summary, the cancellation sentence and the
 * submit button. It reads the form's checked "date" and "dog" boxes, so it needs no extra state from the page.
 * No place counts are ever shown (D101). Without JavaScript it is still a plain submit button.
 */
export function RequestBar({ cancelHours, label }: { cancelHours: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [days, setDays] = useState(0);
  const [dogs, setDogs] = useState(0);

  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const count = () => {
      setDays(form.querySelectorAll('input[name="date"]:checked').length);
      setDogs(form.querySelectorAll('input[name="dog"]:checked').length);
    };
    count();
    form.addEventListener('change', count);
    return () => form.removeEventListener('change', count);
  }, []);

  const summary =
    days === 0 && dogs === 0
      ? 'Choose a dog and your days'
      : `${days} ${days === 1 ? 'day' : 'days'}, ${dogs} ${dogs === 1 ? 'dog' : 'dogs'}`;

  return (
    <div ref={ref} className={s.requestBar}>
      <div className={s.requestBarText}>
        <strong aria-live="polite">{summary}</strong>
        <span className={s.hint}>
          No payment until Luna’s K9 Club approves. You can withdraw a request any time. Once booked, cancel free at
          least {cancelHours} hours before; after that the day is charged.
        </span>
      </div>
      <button type="submit" className={`${s.button} ${s.primary}`}>
        {label}
      </button>
    </div>
  );
}
