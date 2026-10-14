import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * The admin console proxies auth and API calls through its own origin so the session cookie is
 * first-party to the console (no cross-site cookies). The API still enforces every permission.
 */
const config: NextConfig = {
  reactStrictMode: true,
  // Allow the dev server to be opened on 127.0.0.1 (keeps the console's cookies separate from
  // the Expo web app on localhost during local development).
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  poweredByHeader: false,
  devIndicators: false,
  transpilePackages: ['@ghayarly/shared', '@ghayarly/tokens', '@ghayarly/i18n', '@ghayarly/api-client'],
  async rewrites() {
    return [
      { source: '/api/auth/:path*', destination: `${API_URL}/api/auth/:path*` },
      { source: '/v1/:path*', destination: `${API_URL}/v1/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
