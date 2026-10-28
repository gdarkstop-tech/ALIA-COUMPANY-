/**
 * Request log serializer: method, URL, host and address only. Single-use document links carry
 * their ticket in the query string (`t=`), so it is replaced before anything is written.
 */
export function serializeRequest(req: { method: string; url: string; hostname?: string; ip?: string }) {
  return { method: req.method, url: req.url.replace(/([?&]t=)[^&#]+/g, '$1[redacted]'), hostname: req.hostname, remoteAddress: req.ip };
}
