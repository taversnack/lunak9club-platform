import s from '@/ui/ui.module.css';
import { Card } from '@/ui/components';

/** What /account and /admin show while the next page loads. */
export function LoadingCard() {
  return (
    <div role="status" aria-busy="true">
      <span className="visually-hidden">Loading…</span>
      <Card as="div">
        <span className={`${s.skeleton} ${s.skeletonTitle}`} aria-hidden="true" />
        <span className={s.skeleton} aria-hidden="true" />
        <span className={s.skeleton} aria-hidden="true" />
        <span className={`${s.skeleton} ${s.skeletonShort}`} aria-hidden="true" />
      </Card>
    </div>
  );
}
