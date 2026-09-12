// Anonymous visitor metrics tracking using client-generated IDs in KV
const TOTAL = 'visitors:unique';
const VISITS = 'visitors:visits';
const seenKey = (id) => `visitor:${id}`;
const dayKey = (d) => `visitors:day:${d}`;

// Remember devices for 1 year
const REMEMBER_SECONDS = 365 * 24 * 60 * 60;
const DAY_SECONDS = 60 * 60 * 24 * 90; // daily buckets kept for 90 days

const VALID_ID = /^[0-9a-f-]{16,64}$/i;

// Bot and crawler detection pattern
const BOT = /bot|crawl|spider|slurp|bing|baidu|yandex|duckduck|facebookexternalhit|headless|lighthouse|preview|monitor|curl|wget|python-requests/i;

const today = () => new Date().toISOString().slice(0, 10);

// Increment counter key in KV
async function bump(env, key, ttl) {
  const next = Number((await env.CACHE.get(key)) || 0) + 1;
  await env.CACHE.put(key, String(next), ttl ? { expirationTtl: ttl } : undefined);
  return next;
}

// Records a page view and tracks unique vs returning visitors
export async function recordVisit(env, { deviceId, userAgent = '' }) {
  if (!deviceId || !VALID_ID.test(deviceId)) return { counted: false, reason: 'bad-id' };
  if (BOT.test(userAgent)) return { counted: false, reason: 'bot' };

  // Every hit bumps the raw total; only the first from a device bumps uniques.
  await bump(env, VISITS);

  const seen = await env.CACHE.get(seenKey(deviceId));
  if (seen) return { counted: false, reason: 'returning' };

  await env.CACHE.put(seenKey(deviceId), '1', { expirationTtl: REMEMBER_SECONDS });
  await bump(env, TOTAL);
  await bump(env, dayKey(today()), DAY_SECONDS);

  return { counted: true };
}

/** Everything the admin dashboard needs, in one read. */
export async function visitorStats(env) {
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const [unique, visits, ...daily] = await Promise.all([
    env.CACHE.get(TOTAL),
    env.CACHE.get(VISITS),
    ...days.map((d) => env.CACHE.get(dayKey(d))),
  ]);

  const perDay = days.map((date, i) => ({ date, count: Number(daily[i] || 0) }));

  return {
    unique: Number(unique || 0),
    visits: Number(visits || 0),
    today: perDay[0].count,
    last7: perDay.reduce((sum, d) => sum + d.count, 0),
    // Oldest first reads more naturally in a chart.
    daily: perDay.slice().reverse(),
  };
}
