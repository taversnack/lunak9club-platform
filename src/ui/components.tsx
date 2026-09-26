import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import s from './ui.module.css';
import { CheckIcon, ErrorIcon, InfoIcon, WarningIcon } from './icons';

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost';

export function Button({
  variant = 'primary',
  full,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; full?: boolean }) {
  return <button className={cx(s.button, s[variant], full && s.full, className)} {...rest} />;
}

export function buttonClass(variant: Variant = 'primary', full = false): string {
  return cx(s.button, s[variant], full && s.full);
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

export { s as uiStyles };
