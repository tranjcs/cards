'use strict';

/**
 * The client's IP address. Behind a proxy (Cloud Run), the socket address is the proxy's,
 * so the address comes from X-Forwarded-For. Each trusted proxy appends the address it
 * received the request from, so with N trusted proxies the client is the Nth entry from
 * the end; anything before that was supplied by the client and can't be trusted.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} trustedProxyHops - 0 when clients connect directly
 * @returns {string}
 */
function clientAddress(req, trustedProxyHops) {
  if (trustedProxyHops > 0) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const address = forwarded[forwarded.length - trustedProxyHops];
    if (address) return address;
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Browsers always send Origin on WebSocket and cross-site requests, and WebSockets
 * aren't covered by CORS, so this is what stops other websites from opening game
 * connections from their visitors' browsers. Requests without an Origin come from
 * non-browser clients, which can't be used that way.
 * @param {import('node:http').IncomingMessage} req
 */
function isSameOrigin(req) {
  const { origin, host } = req.headers;
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Security headers for every HTTP response. */
const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
});

/** Express middleware that sets SECURITY_HEADERS. */
function securityHeaders(req, res, next) {
  res.set(SECURITY_HEADERS);
  next();
}

module.exports = { clientAddress, isSameOrigin, securityHeaders, SECURITY_HEADERS };
