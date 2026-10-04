import type { NextConfig } from 'next';
import { SERVER_ACTION_BODY_LIMIT_MB } from './src/domain/documents/file-type';

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  serverExternalPackages: ['pino', 'pg'],
  // Uploads are phone photos; the app enforces 10 MB per file (D29). The body limit fits the largest
  // form, an incident report with 5 photos (52 MB), so it fails with our message, not the framework's.
  experimental: { serverActions: { bodySizeLimit: `${SERVER_ACTION_BODY_LIMIT_MB}mb` } },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
