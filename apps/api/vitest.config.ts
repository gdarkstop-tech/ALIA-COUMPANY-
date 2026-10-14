import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_NAME ?? 'ghayarly_test';
const host = process.env.TEST_DATABASE_HOST ?? 'localhost:5432';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      API_PUBLIC_URL: 'http://localhost:4000',
      WEB_ORIGINS: 'http://localhost:8081,http://localhost:3001',
      DATABASE_URL_APP: process.env.TEST_DATABASE_URL_APP ?? `postgres://ghayarly_app:ghayarly_app_dev@${host}/${TEST_DB}`,
      DATABASE_URL_AUTH: process.env.TEST_DATABASE_URL_AUTH ?? `postgres://ghayarly_auth:ghayarly_auth_dev@${host}/${TEST_DB}`,
      DATABASE_URL_OWNER: process.env.TEST_DATABASE_URL_OWNER ?? `postgres://ghayarly_owner:ghayarly_owner_dev@${host}/${TEST_DB}`,
      BETTER_AUTH_SECRET: 'test-only-secret-0123456789abcdefghijklmnopqrstuvwxyz',
      DEMO_MODE: 'true',
      DEV_TOOLS_ENABLED: 'true',
      MFA_ENFORCEMENT: 'warn',
    },
  },
});
