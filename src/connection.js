export function connectionLink(endpoint, code) {
  const url = new URL(endpoint);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash)
    throw new Error('Use an HTTPS backend address, or HTTP on localhost.');
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/.test(code)) throw new Error('Invalid Windows pairing code.');
  // A fragment carries the short-lived code without sending it in HTTP URLs.
  url.hash = 'odyle-pair=' + code;
  return url.href;
}
