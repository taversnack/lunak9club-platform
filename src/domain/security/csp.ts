/**
 * Content-Security-Policy for HTML pages (security review, Low). Built per request with a nonce so Next.js's
 * own inline scripts run and nothing injected into a page can. Pure, so it is unit tested.
 *
 * - script-src: our own files and the nonce'd inline scripts Next adds ('strict-dynamic' lets those load their
 *   chunks). 'unsafe-eval' only in development (Next's dev tooling needs it).
 * - style-src: 'unsafe-inline' is kept because the pages use inline style attributes (a nonce cannot cover
 *   attributes). Scripts are the part that matters.
 * - form-action: our own pages and the card provider's checkout, because paying redirects there.
 * - frame-ancestors 'none' and object-src 'none': no embedding, no plugins.
 */
export const CARD_CHECKOUT_ORIGIN = 'https://checkout.stripe.com';

export function buildCsp(opts: { nonce: string; development: boolean; secure: boolean }): string {
  const script = [
    "'self'",
    `'nonce-${opts.nonce}'`,
    "'strict-dynamic'",
    ...(opts.development ? ["'unsafe-eval'"] : []),
  ];
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', script],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'blob:', 'data:']],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'", CARD_CHECKOUT_ORIGIN]],
    ['frame-ancestors', ["'none'"]],
  ];
  const parts = directives.map(([name, values]) => `${name} ${values.join(' ')}`);
  if (opts.secure) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}
