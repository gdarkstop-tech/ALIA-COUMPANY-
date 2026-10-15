import { Platform } from 'react-native';
import { api } from './api';
import { APP_VARIANT, APP_VERSION } from './config';

const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
let sent = 0;

/**
 * Minimal crash-reporting baseline: anonymous error reports to our own API (no user id, no form
 * values, no tokens — the server redacts again). A full crash-reporting SDK (e.g. Sentry) can
 * replace this once an account exists and the privacy disclosures are updated accordingly.
 */
export function reportError(error: unknown, opts: { fatal: boolean; route?: string }) {
  if (sent >= 20) return; // never flood from a render loop
  sent += 1;
  const e = error instanceof Error ? error : new Error(String(error));
  void api.system
    .reportError({
      name: e.name.slice(0, 100),
      message: e.message.slice(0, 500),
      stack: e.stack?.slice(0, 4000),
      route: opts.route?.slice(0, 200),
      platform,
      appVersion: APP_VERSION,
      appVariant: APP_VARIANT,
      fatal: opts.fatal,
    })
    .catch(() => undefined);
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsShape = { getGlobalHandler: () => GlobalHandler; setGlobalHandler: (h: GlobalHandler) => void };

/** Captures uncaught JS errors on iOS/Android, then defers to React Native's default handler. */
export function installGlobalErrorHandler() {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  if (!errorUtils || Platform.OS === 'web') return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    reportError(error, { fatal: Boolean(isFatal) });
    previous(error, isFatal);
  });
}
