/* Ma semaine EPFL — notification server (Cloudflare Worker).
 * The app sends its upcoming notifications here; a cron every minute pushes the ones that are due.
 * Web Push (RFC 8030/8291/8292) implemented with WebCrypto only, no dependencies. */

const enc = new TextEncoder();
const b64u = buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = str => { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
const concat = (...arrs) => { const n = arrs.reduce((a, x) => a + x.length, 0); const out = new Uint8Array(n); let o = 0; for (const x of arrs) { out.set(x, o); o += x.length; } return out; };
const hmac = async (key, data) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data));
const sha = async s => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s))).slice(0, 22);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

/* ---------- VAPID keys: created once, kept in KV ---------- */
async function getVapid(env) {
  let v = await env.KV.get('vapid', 'json');
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    v = { jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) };
    await env.KV.put('vapid', JSON.stringify(v));
  }
  return v;
}

async function vapidAuth(env, endpoint) {
  const v = await getVapid(env);
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'https://github.com' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.pub}`;
}

/* ---------- aes128gcm payload encryption (RFC 8291) ---------- */
export async function encryptPayload(sub, payload) {
  const uaPublic = unb64u(sub.keys.p256dh), authSecret = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = asPublic.length; header.set(asPublic, 21);
  return concat(header, ct);
}

async function sendPush(env, sub, msg) {
  const body = await encryptPayload(sub, JSON.stringify(msg));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high' },
    body
  });
  return res.status;
}

/* ---------- storage ---------- */
const validSub = s => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
async function index(env) { return (await env.KV.get('subs', 'json')) || []; }

async function handle(req, env) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (url.pathname === '/vapid') return json({ publicKey: (await getVapid(env)).pub });
  if (url.pathname === '/agenda' && req.method === 'GET') {
    const t = url.searchParams.get('t') || '';
    if (!/^[a-f0-9]{24,64}$/.test(t)) return json({ error: 'bad token' }, 400);
    const a = await env.KV.get('agenda:' + t, 'json');
    return json(a || { agenda: [] });
  }
  if (url.pathname === '/health') return json({ ok: true, subs: (await index(env)).length });
  if (req.method !== 'POST') return json({ error: 'not found' }, 404);
  const text = await req.text();
  if (text.length > 200000) return json({ error: 'too large' }, 413);
  let data; try { data = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
  if (url.pathname === '/agenda') {
    const t = String(data.token || '');
    if (!/^[a-f0-9]{24,64}$/.test(t)) return json({ error: 'bad token' }, 400);
    const agenda = (Array.isArray(data.agenda) ? data.agenda : []).slice(0, 60).map(x => ({ s: +x.s, e: +x.e, t: String(x.t || '').slice(0, 80), u: String(x.u || '').slice(0, 80), c: String(x.c || '').slice(0, 9), k: String(x.k || '').slice(0, 10) }));
    await env.KV.put('agenda:' + t, JSON.stringify({ mode: String(data.mode || '').slice(0, 20), agenda, at: Date.now() }), { expirationTtl: 60 * 60 * 24 * 30 });
    return json({ ok: true });
  }
  if (!validSub(data.subscription)) return json({ error: 'bad subscription' }, 400);
  const id = await sha(data.subscription.endpoint);

  if (url.pathname === '/sync') {
    const list = Array.isArray(data.notifications) ? data.notifications : [];
    const notifications = list.slice(0, 500).filter(n => n && Number.isFinite(n.at)).map(n => ({ at: n.at, title: String(n.title || '').slice(0, 120), body: String(n.body || '').slice(0, 240), tag: String(n.tag || '').slice(0, 60) }));
    await env.KV.put('sub:' + id, JSON.stringify({ subscription: data.subscription, notifications, syncedAt: Date.now() }));
    if (data.backup && typeof data.backup === 'object') await env.KV.put('backup:' + id, JSON.stringify(data.backup).slice(0, 180000));
    const subs = await index(env);
    if (!subs.includes(id)) { subs.push(id); while (subs.length > 20) subs.shift(); await env.KV.put('subs', JSON.stringify(subs)); }
    return json({ ok: true, id, count: notifications.length });
  }
  if (url.pathname === '/test') {
    const status = await sendPush(env, data.subscription, { title: 'Ça marche !', body: 'Les notifs d’EPFL Calendar sont activées.', tag: 'test' });
    return json({ ok: status >= 200 && status < 300, status });
  }
  if (url.pathname === '/unsubscribe') {
    await env.KV.delete('sub:' + id);
    await env.KV.put('subs', JSON.stringify((await index(env)).filter(x => x !== id)));
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}

async function tick(env, when) {
  const lo = when - 30000, hi = when + 30000;
  const subs = await index(env);
  for (const id of subs) {
    const rec = await env.KV.get('sub:' + id, 'json');
    if (!rec) continue;
    const due = rec.notifications.filter(n => n.at >= lo && n.at < hi);
    for (const n of due) {
      try {
        const status = await sendPush(env, rec.subscription, n);
        if (status === 404 || status === 410) { await env.KV.delete('sub:' + id); await env.KV.put('subs', JSON.stringify(subs.filter(x => x !== id))); break; }
      } catch (e) { console.log('push failed', e && e.message); }
    }
  }
}

export default {
  fetch: (req, env) => handle(req, env).catch(e => json({ error: String(e && e.message || e) }, 500)),
  scheduled: (event, env, ctx) => { ctx.waitUntil(tick(env, event.scheduledTime)); }
};
