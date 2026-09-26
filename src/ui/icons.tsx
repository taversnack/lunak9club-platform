// Small inline icons so status is never conveyed by colour alone.
type P = { title?: string };
const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};
const svg = (title: string | undefined, children: React.ReactNode) => (
  <svg {...base} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
    {title ? <title>{title}</title> : null}
    {children}
  </svg>
);
export const InfoIcon = ({ title }: P) =>
  svg(
    title,
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>,
  );
export const CheckIcon = ({ title }: P) =>
  svg(
    title,
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12 3 3 5-6" />
    </>,
  );
export const WarningIcon = ({ title }: P) =>
  svg(
    title,
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>,
  );
export const ErrorIcon = ({ title }: P) =>
  svg(
    title,
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
    </>,
  );
