'use client';
import { createContext, useActionState, useContext, useId, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import s from './ui.module.css';
import { Alert } from './components';

type ActionState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
};

type Ctx = { fields: Record<string, string>; values: Record<string, string> };
const FormCtx = createContext<Ctx>({ fields: {}, values: {} });
/** A field's error and submitted value from the surrounding ActionForm. */
export const useField = (name: string) => {
  const c = useContext(FormCtx);
  return { error: c.fields[name], value: c.values[name] };
};

/** A form bound to a server action, with an error summary and per-field messages. */
export function ActionForm({
  action,
  children,
  successMessage,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  successMessage?: string;
}) {
  const [state, formAction] = useActionState(action, { status: 'idle' } as ActionState);
  const fields = state.fields ?? {};
  const count = Object.keys(fields).length;
  // No encType/method: React sets a multipart POST itself for a function action (and warns if given).
  return (
    <form action={formAction} noValidate>
      <FormCtx.Provider value={{ fields, values: state.values ?? {} }}>
        <div className={s.stack}>
          {state.status === 'error' ? (
            <Alert
              tone="danger"
              title={count ? `There ${count === 1 ? 'is a problem' : `are ${count} problems`}` : 'That didn’t work'}
            >
              {state.message}
            </Alert>
          ) : null}
          {state.status === 'success' && (state.message || successMessage) ? (
            <Alert tone="success">{state.message ?? successMessage}</Alert>
          ) : null}
          {children}
        </div>
      </FormCtx.Provider>
    </form>
  );
}

function Label({ htmlFor, label, required }: { htmlFor: string; label: string; required?: boolean }) {
  return (
    <label className={s.label} htmlFor={htmlFor}>
      {label}
      {required ? null : <span className={s.hint}> (optional)</span>}
    </label>
  );
}

function Described({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  return (
    <>
      {hint ? (
        <span id={`${id}-hint`} className={s.hint}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-err`} className={s.error}>
          Error: {error}
        </span>
      ) : null}
    </>
  );
}

const describedBy = (id: string, hint?: string, error?: string) =>
  [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;

type Common = { name: string; label: string; hint?: string; required?: boolean; defaultValue?: string | number | null };

export function TextField({
  name,
  label,
  hint,
  required,
  defaultValue,
  type = 'text',
  ...rest
}: Common & {
  type?: string;
  autoComplete?: string;
  inputMode?: 'numeric' | 'decimal' | 'tel' | 'email' | 'text';
  step?: string;
  max?: string;
  min?: string;
}) {
  const id = useId();
  const { error, value } = useField(name);
  return (
    <div className={s.field}>
      <Label htmlFor={id} label={label} required={required} />
      <Described id={id} hint={hint} error={error} />
      <input
        id={id}
        name={name}
        type={type}
        className={s.input}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        defaultValue={value ?? defaultValue ?? undefined}
        {...rest}
      />
    </div>
  );
}

export function TextArea({ name, label, hint, required, defaultValue, rows = 3 }: Common & { rows?: number }) {
  const id = useId();
  const { error, value } = useField(name);
  return (
    <div className={s.field}>
      <Label htmlFor={id} label={label} required={required} />
      <Described id={id} hint={hint} error={error} />
      <textarea
        id={id}
        name={name}
        rows={rows}
        className={`${s.input} ${s.textarea}`}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        defaultValue={value ?? defaultValue ?? undefined}
      />
    </div>
  );
}

export function RadioGroup({
  name,
  label,
  hint,
  options,
  defaultValue,
  required = true,
}: Common & { options: { value: string; label: string }[] }) {
  const id = useId();
  const { error, value } = useField(name);
  const current = value ?? (defaultValue == null ? undefined : String(defaultValue));
  return (
    <fieldset
      className={s.fieldset}
      aria-describedby={describedBy(id, hint, error)}
      aria-invalid={error ? true : undefined}
    >
      <legend className={s.label}>
        {label}
        {required ? null : <span className={s.hint}> (optional)</span>}
      </legend>
      <Described id={id} hint={hint} error={error} />
      <div className={s.choices}>
        {options.map((o) => (
          <label key={o.value} className={s.choice}>
            <input type="radio" name={name} value={o.value} defaultChecked={current === o.value} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SelectField({
  name,
  label,
  hint,
  options,
  defaultValue,
  required = true,
}: Common & { options: { value: string; label: string }[] }) {
  const id = useId();
  const { error, value } = useField(name);
  return (
    <div className={s.field}>
      <Label htmlFor={id} label={label} required={required} />
      <Described id={id} hint={hint} error={error} />
      <select
        id={id}
        name={name}
        className={s.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        defaultValue={value ?? defaultValue ?? ''}
      >
        <option value="" disabled>
          Choose…
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Checkbox({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  const id = useId();
  const { error, value } = useField(name);
  return (
    <div className={s.field}>
      <Described id={id} hint={hint} error={error} />
      <label className={s.choice} htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          name={name}
          defaultChecked={value !== undefined ? value === 'on' : defaultChecked}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
        />
        <span>{label}</span>
      </label>
    </div>
  );
}

export function FileField({
  name,
  label,
  hint,
  accept,
  multiple,
  required = true,
}: {
  name: string;
  label: string;
  hint?: string;
  accept?: string;
  multiple?: boolean;
  required?: boolean;
}) {
  const id = useId();
  const { error } = useField(name);
  return (
    <div className={s.field}>
      <Label htmlFor={id} label={label} required={required} />
      <Described id={id} hint={hint} error={error} />
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        multiple={multiple}
        className={s.file}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
      />
    </div>
  );
}

export function FieldError({ name }: { name: string }) {
  const { error } = useField(name);
  return error ? <span className={s.error}>Error: {error}</span> : null;
}

export function SubmitButton({
  children,
  pendingText,
  variant = 'primary',
  name,
  value,
  disabled = false,
  describedBy,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  name?: string;
  value?: string;
  /** Blocked for a reason shown next to the button (pass its id as describedBy). */
  disabled?: boolean;
  describedBy?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={`${s.button} ${s[variant]}`}
      disabled={pending || disabled}
      aria-disabled={pending || disabled}
      aria-describedby={describedBy}
      aria-busy={pending || undefined}
    >
      {pending ? <span className={s.spinner} aria-hidden="true" /> : null}
      {pending ? (pendingText ?? 'Saving…') : children}
    </button>
  );
}

/**
 * Submit button with a spinner and aria-busy while submitting. Works inside a <form action> (reads
 * useFormStatus) or, for client forms that submit with fetch, pass `pending` yourself.
 */
export function PendingButton({
  children,
  pendingText = 'Loading…',
  variant = 'primary',
  pending: pendingProp,
  full = false,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'cta';
  pending?: boolean;
  full?: boolean;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <button
      type="submit"
      className={`${s.button} ${s[variant]}${full ? ` ${s.full}` : ''}`}
      aria-busy={pending || undefined}
      disabled={pending}
    >
      {pending ? <span className={s.spinner} aria-hidden="true" /> : null}
      {pending ? pendingText : children}
    </button>
  );
}
