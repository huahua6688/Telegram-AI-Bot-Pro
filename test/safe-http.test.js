import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  SafeHttpError,
  isBlockedNetworkAddress,
  parsePublicHttpUrl,
  resolvePublicTarget,
  safeFetchBuffer
} from '../src/utils/safe-http.js';

test('safe URL validation blocks local, private, credentialed, and non-web targets', () => {
  for (const value of [
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://[::1]/',
    'http://localhost/',
    'http://service.internal/',
    'https://user:password@example.com/',
    'https://example.com:8080/',
    'file:///etc/passwd'
  ]) {
    assert.throws(() => parsePublicHttpUrl(value), SafeHttpError, value);
  }
  assert.equal(parsePublicHttpUrl('https://example.com/path#fragment').toString(), 'https://example.com/path');
});

test('network classification blocks private and reserved IP ranges', () => {
  for (const value of ['0.0.0.0', '10.1.2.3', '100.64.1.2', '169.254.169.254', '192.168.1.2', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isBlockedNetworkAddress(value), true, value);
  }
  assert.equal(isBlockedNetworkAddress('8.8.8.8'), false);
  assert.equal(isBlockedNetworkAddress('2606:4700:4700::1111'), false);
});

test('DNS resolution rejects a hostname when any returned address is private', async () => {
  await assert.rejects(
    resolvePublicTarget('https://example.com/', {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 }
      ]
    }),
    (error) => error?.code === 'URL_ADDRESS_BLOCKED'
  );
});

function createRequestFactory(responses) {
  let call = 0;
  return (_url, _options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = (error) => queueMicrotask(() => request.emit('error', error));
    request.end = () => queueMicrotask(() => {
      const spec = responses[call++] || responses.at(-1);
      const response = new PassThrough();
      response.statusCode = spec.statusCode;
      response.headers = spec.headers || {};
      callback(response);
      response.end(spec.body || '');
    });
    return request;
  };
}

test('redirect targets are validated before the next request', async () => {
  await assert.rejects(
    safeFetchBuffer('https://example.com/', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      requestFactory: createRequestFactory([{
        statusCode: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' }
      }]),
      maxRedirects: 3
    }),
    (error) => error?.code === 'URL_ADDRESS_BLOCKED'
  );
});

test('streamed response body is stopped at the configured byte limit', async () => {
  await assert.rejects(
    safeFetchBuffer('https://example.com/', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      requestFactory: createRequestFactory([{
        statusCode: 200,
        body: 'x'.repeat(33)
      }]),
      maxBytes: 32
    }),
    (error) => error?.code === 'RESPONSE_TOO_LARGE'
  );
});
