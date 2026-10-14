import { loadEnv } from './config/env';
import { buildServer } from './server';

const env = loadEnv();
const app = await buildServer(env);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received — shutting down`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
  if (env.DEMO_MODE) app.log.warn('DEMO_MODE is ON — synthetic showcase data is visible. Never enable in production.');
  if (env.MFA_ENFORCEMENT !== 'required') app.log.warn('MFA_ENFORCEMENT=warn — staff/clinician MFA is not enforced (development only).');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
