/**
 * Web build (development / E2E harness only): there is no app store on the web, so every call
 * fails closed and nothing can be purchased or unlocked.
 */
const unavailable = async (): Promise<never> => {
  throw new Error('STORE_UNAVAILABLE_ON_WEB');
};
const noopSubscription = { remove: () => undefined };

export const initConnection = unavailable;
export const endConnection = async () => true;
export const fetchProducts = unavailable;
export const requestPurchase = unavailable;
export const finishTransaction = unavailable;
export const getAvailablePurchases = async () => [];
export const deepLinkToSubscriptions = unavailable;
export const purchaseUpdatedListener = (_listener: unknown) => noopSubscription;
export const purchaseErrorListener = (_listener: unknown) => noopSubscription;
export const isUserCancelledError = (_e: unknown) => false;
