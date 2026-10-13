import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import s from './ui.module.css';
import { CheckIcon, ErrorIcon, InfoIcon, WarningIcon } from './icons';

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

export function Button({
  variant = 'primary',
  size = 'md',
  full,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; full?: boolean }) {
  return (
    <button
      className={cx(
        s.button,
        variant === 'danger' ? s.buttonDanger : s[variant],
        size === 'sm' && s.sm,
        full && s.full,
        className,
      )}
      {...rest}
    />
  );
}

export function buttonClass(variant: Variant = 'primary', full = false, size: Size = 'md'): string {
  return cx(s.button, variant === 'danger' ? s.buttonDanger : s[variant], size === 'sm' && s.sm, full && s.full);
}

export function Card({
  children,
  as: As = 'section',
  ...rest
}: {
  children: ReactNode;
  as?: 'section' | 'div' | 'article';
  'aria-labelledby'?: string;
}) {
  return (
    <As className={s.card} {...rest}>
      {children}
    </As>
  );
}

export function Stack({ children }: { children: ReactNode }) {
  return <div className={s.stack}>{children}</div>;
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className={s.grid}>{children}</div>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className={s.muted}>{children}</p>;
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  hint?: string;
  error?: string;
};

/** Labelled input with hint and error wired to aria-describedby. */
export function Field({ label, name, hint, error, id, ...input }: FieldProps) {
  const inputId = id ?? `f-${name}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errId = error ? `${inputId}-err` : undefined;
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={inputId}>
        {label}
        {input.required ? null : <span className={s.hint}> (optional)</span>}
      </label>
      {hint ? (
        <span id={hintId} className={s.hint}>
          {hint}
        </span>
      ) : null}
      <input
        id={inputId}
        name={name}
        className={s.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errId].filter(Boolean).join(' ') || undefined}
        {...input}
      />
      {error ? (
        <span id={errId} className={s.error}>
          Error: {error}
        </span>
      ) : null}
    </div>
  );
}

type Tone = 'info' | 'success' | 'warning' | 'danger';
const toneIcon = { info: InfoIcon, success: CheckIcon, warning: WarningIcon, danger: ErrorIcon };

export function Alert({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const Icon = toneIcon[tone];
  return (
    <div className={cx(s.alert, s[`alert_${tone}`])} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon />
      <div>
        {title ? <strong>{title}</strong> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}

/** Status pill: always icon + text, never colour alone. */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = toneIcon[tone];
  return (
    <span className={cx(s.badge, s[`alert_${tone}`])}>
      <Icon />
      {children}
    </span>
  );
}

/** Page title with optional lead text and actions; one h1 per page. */
export function PageHeader({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className={s.pageHeader}>
      <div>
        <h1>{title}</h1>
        {lead ? <p className={s.muted}>{lead}</p> : null}
      </div>
      {actions ? <div className={s.pageActions}>{actions}</div> : null}
    </header>
  );
}

/** Dashboard figure: label, value and optional detail/link. Heading level is configurable for correct outline. */
export function StatCard({
  label,
  value,
  detail,
  href,
  linkText,
  headingLevel = 2,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  href?: Route;
  linkText?: string;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const id = `stat-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section className={cx(s.card, s.statCard)} aria-labelledby={id}>
      <H id={id} className={s.statLabel}>
        {label}
      </H>
      <p className={s.bigNumber}>{value}</p>
      {detail ? <p className={s.statDetail}>{detail}</p> : null}
      {href && linkText ? <Link href={href}>{linkText}</Link> : null}
    </section>
  );
}

/** Shown when a list or table has nothing in it. Always says what to do next when there is an action. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty} role="status">
      <p className={s.emptyTitle}>{title}</p>
      {children ? <div className={s.muted}>{children}</div> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

/** Scrollable, captioned table wrapper. Caption is required for screen readers (can be visually hidden). */
export function DataTable({
  caption,
  captionHidden,
  children,
}: {
  caption: string;
  captionHidden?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={s.tableWrap} role="region" aria-label={caption} tabIndex={0}>
      <table className={s.table}>
        <caption className={captionHidden ? 'visually-hidden' : s.caption}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/** Section navigation. Marks the current item with aria-current, not colour alone. */
export function SubNav({
  label,
  items,
  current,
}: {
  label: string;
  items: Array<{ href: Route; label: string }>;
  current?: string;
}) {
  return (
    <nav aria-label={label}>
      <ul className={s.subnavList}>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={i.href === current ? 'page' : undefined}>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export { s as uiStyles };
