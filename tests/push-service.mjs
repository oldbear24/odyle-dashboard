import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createECDH, randomBytes, hkdfSync, createDecipheriv } from 'node:crypto';

// A browser's push service on this machine (test builds of the backend may post to
// 127.0.0.1): what the backend sends is decrypted with this browser's keys alone, as a
// browser does (RFC 8291). `status` is what the push service answers; `keys` and
// `endpoint` are what the browser would send to POST /api/odyle/push-subscribe.
export async function pushService() {
  const key = createECDH('prime256v1'); key.generateKeys();
  const service = { publicKey: key.getPublicKey(), secret: randomBytes(16), received: [], status: 201 };
  const derive = (ikm, salt, info, size) => Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from(info), size));
  const decrypt = body => {
    const salt = body.subarray(0, 16), size = body[20], sender = body.subarray(21, 21 + size), sealed = body.subarray(21 + size);
    const ikm = derive(key.computeSecret(sender), service.secret, Buffer.concat([Buffer.from('WebPush: info\0'), service.publicKey, sender]), 32);
    const decipher = createDecipheriv('aes-128-gcm', derive(ikm, salt, 'Content-Encoding: aes128gcm\0', 16), derive(ikm, salt, 'Content-Encoding: nonce\0', 12));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
    assert.equal(plain[plain.length - 1], 2, 'one record, the last');
    return JSON.parse(plain.subarray(0, plain.length - 1).toString());
  };
  service.server = createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => { service.received.push({ headers: req.headers, message: decrypt(Buffer.concat(chunks)) }); res.writeHead(service.status); res.end(); });
  });
  await new Promise(done => service.server.listen(0, '127.0.0.1', done));
  // Never what keeps a test process running, even when a test fails before closing it.
  service.server.unref();
  service.close = () => { service.server.closeAllConnections(); service.server.close(); };
  service.endpoint = 'http://127.0.0.1:' + service.server.address().port + '/push/' + randomBytes(6).toString('hex');
  service.keys = { p256dh: service.publicKey.toString('base64url'), auth: service.secret.toString('base64url') };
  return service;
}
