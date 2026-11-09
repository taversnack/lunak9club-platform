// Decorative 24px line icons for navigation (always paired with visible text).
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};
export const BookIcon = () => (
  <svg {...base}>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
export const ListIcon = () => (
  <svg {...base}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);
export const PawIcon = () => (
  <svg {...base}>
    <circle cx="6" cy="10" r="2" />
    <circle cx="10" cy="5.5" r="2" />
    <circle cx="14" cy="5.5" r="2" />
    <circle cx="18" cy="10" r="2" />
    <path d="M12 12c-3 0-5.5 3-5.5 5.2 0 1.6 1.4 2.3 3 2 1-.2 1.6-.5 2.5-.5s1.5.3 2.5.5c1.6.3 3-.4 3-2C17.5 15 15 12 12 12z" />
  </svg>
);
export const PersonIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </svg>
);
