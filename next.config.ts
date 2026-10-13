import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Stop `next dev` from writing its agent-rules block into the tracked CLAUDE.md.
  agentRules: false,
  poweredByHeader: false,
  typedRoutes: true,
  serverExternalPackages: ['pino', 'pg'],
  // Vaccination records can be phone photos; the app itself enforces 10 MB (D29).
  experimental: { serverActions: { bodySizeLimit: '11mb' } },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
