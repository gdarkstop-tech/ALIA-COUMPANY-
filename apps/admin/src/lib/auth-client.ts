'use client';
import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Same-origin Better Auth client (requests are proxied by Next.js rewrites to the API). */
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [twoFactorClient({ onTwoFactorRedirect: () => window.location.assign('/login?step=2fa') })],
});
