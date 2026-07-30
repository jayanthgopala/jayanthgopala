import { sign, verify } from 'hono/jwt';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

export const SESSION_COOKIE = 'pf_session';
const SESSION_TTL = 60 * 60 * 12; // 12 hours

// Pinned explicitly rather than left to the library default: recent Hono
// versions require `alg` on verify, and stating it on both sides removes any
// chance of a sign/verify mismatch after an upgrade.
const ALG = 'HS256';

/**
 * Constant-time comparison. Prevents leaking the password through response
 * timing — cheap to do, so we do it.
 */
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ba = enc.encode(String(a));
  const bb = enc.encode(String(b));

  // Compare a fixed number of bytes so length alone is not a signal.
  let diff = ba.length ^ bb.length;
  const len = Math.max(ba.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export function checkPassword(env, candidate) {
  if (!env.ADMIN_PASSWORD) return false;
  return safeEqual(candidate, env.ADMIN_PASSWORD);
}

export async function issueSession(c) {
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(
    { sub: 'admin', iat: now, exp: now + SESSION_TTL },
    c.env.JWT_SECRET,
    ALG
  );

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    // The admin panel is on a different origin than the API, so the session
    // cookie has to be cross-site. `secure` is mandatory alongside this.
    sameSite: 'None',
    path: '/',
    maxAge: SESSION_TTL,
  });

  return token;
}

export function clearSession(c) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, sameSite: 'None' });
}

/**
 * Accepts the httpOnly cookie or an `Authorization: Bearer` header, so the
 * same API serves the browser panel and any scripts or CI you point at it.
 */
export async function readSession(c) {
  let token = getCookie(c, SESSION_COOKIE);

  if (!token) {
    const header = c.req.header('Authorization') || '';
    if (header.startsWith('Bearer ')) token = header.slice(7);
  }
  if (!token) return null;

  try {
    return await verify(token, c.env.JWT_SECRET, ALG);
  } catch {
    // Expired or tampered — both are simply "not signed in".
    return null;
  }
}

/** Hono middleware guarding every /api/admin route. */
export function requireAuth() {
  return async (c, next) => {
    const session = await readSession(c);
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    c.set('session', session);
    await next();
  };
}
