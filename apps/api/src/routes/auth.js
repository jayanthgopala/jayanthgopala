import { Hono } from 'hono';
import { checkPassword, issueSession, clearSession, readSession } from '../lib/auth.js';

const app = new Hono();

app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));

  if (!checkPassword(c.env, body.password)) {
    // Uniform delay + message: no hint about whether the account "exists".
    await new Promise((r) => setTimeout(r, 400));
    return c.json({ error: 'invalid credentials' }, 401);
  }

  const token = await issueSession(c);
  // Token is also returned so non-browser clients can use the Bearer header.
  return c.json({ ok: true, token });
});

app.post('/logout', (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

app.get('/me', async (c) => {
  const session = await readSession(c);
  if (!session) return c.json({ authenticated: false }, 401);
  return c.json({ authenticated: true, sub: session.sub, exp: session.exp });
});

export default app;
