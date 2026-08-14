import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const BLOCKED_NETWORKS = new BlockList();

for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
]) {
  BLOCKED_NETWORKS.addSubnet(address, prefix, 'ipv4');
}

for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32]
]) {
  BLOCKED_NETWORKS.addSubnet(address, prefix, 'ipv6');
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export class SafeHttpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SafeHttpError';
    this.code = code;
  }
}

function normalizeHostname(hostname = '') {
  return String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function mappedIpv4(address = '') {
  const match = String(address).toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return match?.[1] || '';
}

export function isBlockedNetworkAddress(address = '') {
  const normalized = normalizeHostname(address);
  const mapped = mappedIpv4(normalized);
  if (mapped) return isBlockedNetworkAddress(mapped);
  const family = isIP(normalized);
  if (family === 4) return BLOCKED_NETWORKS.check(normalized, 'ipv4');
  if (family === 6) return BLOCKED_NETWORKS.check(normalized, 'ipv6');
  return true;
}

export function parsePublicHttpUrl(input, { allowedPorts = ['80', '443'] } = {}) {
  let url;
  try {
    url = input instanceof URL ? new URL(input.toString()) : new URL(String(input || ''));
  } catch {
    throw new SafeHttpError('URL_INVALID', 'The URL is invalid.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new SafeHttpError('URL_PROTOCOL_BLOCKED', 'Only HTTP and HTTPS URLs are allowed.');
  }
  if (url.username || url.password) {
    throw new SafeHttpError('URL_CREDENTIALS_BLOCKED', 'URLs containing credentials are not allowed.');
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || hostname === 'localhost' || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new SafeHttpError('URL_HOST_BLOCKED', 'Local and private hostnames are not allowed.');
  }
  if (url.port && !allowedPorts.map(String).includes(url.port)) {
    throw new SafeHttpError('URL_PORT_BLOCKED', 'The URL uses a blocked port.');
  }
  if (isIP(hostname) && isBlockedNetworkAddress(hostname)) {
    throw new SafeHttpError('URL_ADDRESS_BLOCKED', 'Private and reserved network addresses are not allowed.');
  }
  url.hash = '';
  return url;
}

export async function resolvePublicTarget(input, options = {}) {
  const url = parsePublicHttpUrl(input, options);
  const hostname = normalizeHostname(url.hostname);
  const resolver = options.lookup || dnsLookup;
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolver(hostname, { all: true, verbatim: true });

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new SafeHttpError('URL_DNS_EMPTY', 'The URL hostname did not resolve to an address.');
  }
  if (addresses.some((entry) => isBlockedNetworkAddress(entry.address))) {
    throw new SafeHttpError('URL_ADDRESS_BLOCKED', 'The URL resolves to a private or reserved network address.');
  }

  const selected = addresses.find((entry) => Number(entry.family) === 4) || addresses[0];
  return {
    url,
    address: String(selected.address),
    family: Number(selected.family) || isIP(selected.address)
  };
}

function requestOnce(target, {
  headers = {},
  timeoutMs = 8000,
  maxBytes = 1024 * 1024,
  signal,
  requestFactory
} = {}) {
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === 'https:' ? https : http;
    const factory = requestFactory || transport.request.bind(transport);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    const request = factory(target.url, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5',
        ...headers
      },
      autoSelectFamily: false,
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family)
    }, (response) => {
      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength > maxBytes) {
        response.destroy();
        finish(new SafeHttpError('RESPONSE_TOO_LARGE', `The response exceeds the ${maxBytes}-byte limit.`));
        return;
      }

      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          response.destroy();
          finish(new SafeHttpError('RESPONSE_TOO_LARGE', `The response exceeds the ${maxBytes}-byte limit.`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, {
        statusCode: Number(response.statusCode || 0),
        headers: response.headers,
        body: Buffer.concat(chunks),
        url: target.url
      }));
      response.on('error', (error) => finish(error));
    });

    request.setTimeout(Math.max(100, Number(timeoutMs) || 8000), () => {
      request.destroy(new SafeHttpError('REQUEST_TIMEOUT', 'The URL request timed out.'));
    });
    request.on('error', (error) => finish(error));

    const abort = () => request.destroy(signal?.reason || new SafeHttpError('REQUEST_ABORTED', 'The URL request was aborted.'));
    if (signal?.aborted) abort();
    else signal?.addEventListener?.('abort', abort, { once: true });
    request.end();
  });
}

export async function safeFetchBuffer(input, options = {}) {
  const maxRedirects = Math.max(0, Math.min(5, Number(options.maxRedirects) || 0));
  let current = parsePublicHttpUrl(input, options);

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const target = await resolvePublicTarget(current, options);
    const response = await requestOnce(target, options);
    if (!REDIRECT_STATUS_CODES.has(response.statusCode)) return response;

    const location = String(response.headers.location || '').trim();
    if (!location) return response;
    if (redirects >= maxRedirects) {
      throw new SafeHttpError('TOO_MANY_REDIRECTS', 'The URL exceeded the redirect limit.');
    }
    current = parsePublicHttpUrl(new URL(location, current), options);
  }

  throw new SafeHttpError('TOO_MANY_REDIRECTS', 'The URL exceeded the redirect limit.');
}

export async function safeFetchText(input, options = {}) {
  const response = await safeFetchBuffer(input, options);
  return {
    ...response,
    body: response.body.toString('utf8')
  };
}
