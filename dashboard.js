// dashboard.js
// Small website: "Login with Discord", pick a mutual server, choose a
// channel, save. Runs as its own web server alongside the bot process.

const express = require('express');
const session = require('express-session');
const https = require('https');
const crypto = require('crypto');

const { setGuildChannel, getGuildChannel, getAllConfiguredGuilds } = require('./db.js');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3000';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const REDIRECT_URI = `${PUBLIC_URL}/callback`;

// Without a real secret anyone could forge a login cookie, so refuse to start.
if (SESSION_SECRET.length < 16 || /PASTE|change-this/i.test(SESSION_SECRET)) {
  throw new Error('SESSION_SECRET must be set to a long random string before the dashboard can start.');
}

const app = express();
app.set('trust proxy', 1);
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: PUBLIC_URL.startsWith('https://') },
}));

// HTML-escape anything that came from Discord (server and channel names) before putting it on a page
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Discord IDs are plain numbers; anything else is refused (stops odd values reaching the Discord API path)
const isId = (s) => /^\d{15,22}$/.test(String(s || ''));
const MANAGE_GUILD = 0x20;

// The server only if this logged-in user can manage it AND the bot is in it, otherwise null.
async function manageableGuild(req, guildId) {
  if (!isId(guildId)) return null;
  const userGuilds = await discordApi('/users/@me/guilds', { token: req.session.accessToken });
  const g = (Array.isArray(userGuilds) ? userGuilds : []).find((x) => x.id === guildId);
  if (!g || (Number(g.permissions) & MANAGE_GUILD) !== MANAGE_GUILD) return null;
  const botGuilds = await discordApi('/users/@me/guilds', { isBot: true });
  if (!(Array.isArray(botGuilds) ? botGuilds : []).some((x) => x.id === guildId)) return null;
  return g;
}

// --- tiny helper for calling Discord's REST API ---
function discordApi(pathname, { method = 'GET', token, isBot = false, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'discord.com',
      path: `/api/v10${pathname}`,
      method,
      headers: {
        Authorization: isBot ? `Bot ${BOT_TOKEN}` : `Bearer ${token}`,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function exchangeCodeForToken(code) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }).toString();

    const options = {
      hostname: 'discord.com',
      path: '/api/v10/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(params);
    req.end();
  });
}

function page(title, body) {
  return `<!doctype html>
<html><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>
  body { background:#0a0e14; color:#fff; font-family:Arial, sans-serif; max-width:640px; margin:60px auto; padding:0 20px; }
  h1 { color:#0ff796; }
  a.btn, button { background:#0ff796; color:#0a0e14; border:none; padding:10px 18px; border-radius:6px; font-weight:bold; text-decoration:none; cursor:pointer; font-size:15px; }
  .card { background:#111826; border:1px solid #2ee6ff; border-radius:8px; padding:16px; margin:10px 0; display:flex; justify-content:space-between; align-items:center; }
  select { padding:8px; border-radius:6px; }
</style></head><body>${body}</body></html>`;
}

// --- Routes ---

// Public stats endpoint - no login required, safe to call from the
// separate landing page's own JavaScript.
app.get('/stats', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  try {
    const activeServers = getAllConfiguredGuilds().length;
    const botGuilds = await discordApi('/users/@me/guilds', { isBot: true });
    const totalServers = (botGuilds || []).length;
    res.json({ activeServers, totalServers });
  } catch (err) {
    res.status(500).json({ error: 'Could not load stats' });
  }
});

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  // a one-time "state" value stops another site from logging you in to someone else's Discord account
  req.session.oauthState = crypto.randomBytes(16).toString('hex');
  const authUrl = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds&state=${req.session.oauthState}`;
  res.send(page('Delta Force Door Codes', `
    <h1>Delta Force Door Codes</h1>
    <p>Add the bot to your server, then log in here to pick which channel gets the daily codes.</p>
    <a class="btn" href="${authUrl}">Login with Discord</a>
  `));
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  if (!code || typeof code !== 'string') return res.redirect('/');
  if (!state || state !== req.session.oauthState) return res.redirect('/');
  delete req.session.oauthState;

  try {
    const tokenData = await exchangeCodeForToken(code);
    if (!tokenData || !tokenData.access_token) throw new Error('no token');
    const user = await discordApi('/users/@me', { token: tokenData.access_token });
    if (!user || !user.id) throw new Error('no user');
    // new session on login (stops a planted session id being reused)
    req.session.regenerate((e) => {
      if (e) return res.status(500).send(page('Error', '<p>Login failed.</p><a href="/">Try again</a>'));
      req.session.user = { id: user.id, username: user.username };
      req.session.accessToken = tokenData.access_token;
      res.redirect('/dashboard');
    });
  } catch (err) {
    console.error('Login failed:', err);
    res.status(500).send(page('Error', `<p>Login failed.</p><a href="/">Try again</a>`));
  }
});

app.get('/dashboard', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const userGuilds = await discordApi('/users/@me/guilds', { token: req.session.accessToken });
  const botGuilds = await discordApi('/users/@me/guilds', { isBot: true });
  const botGuildIds = new Set((botGuilds || []).map(g => g.id));

  // Only show servers where the user can manage the server AND the bot is present
  const mutual = (Array.isArray(userGuilds) ? userGuilds : []).filter(g =>
    botGuildIds.has(g.id) && (Number(g.permissions) & MANAGE_GUILD) === MANAGE_GUILD
  );

  const list = mutual.map(g => `
    <div class="card">
      <span>${esc(g.name)}</span>
      <a class="btn" href="/guild/${esc(g.id)}">Configure</a>
    </div>
  `).join('') || '<p>No mutual servers found. Make sure the bot is invited and you have Manage Server permission.</p>';

  res.send(page('Dashboard', `
    <h1>Your Servers</h1>
    ${list}
  `));
});

app.get('/guild/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const guildId = req.params.id;
  // only servers this user is allowed to manage
  if (!(await manageableGuild(req, guildId))) return res.status(403).send(page('Not allowed', '<p>You need Manage Server permission in that server.</p><a href="/dashboard">Back</a>'));

  const channels = await discordApi(`/guilds/${guildId}/channels`, { isBot: true });
  const textChannels = (Array.isArray(channels) ? channels : []).filter(c => c.type === 0);
  const current = getGuildChannel(guildId);

  const options = textChannels.map(c =>
    `<option value="${esc(c.id)}" ${c.id === current ? 'selected' : ''}>#${esc(c.name)}</option>`
  ).join('');

  res.send(page('Configure Server', `
    <h1>Configure Channel</h1>
    <form method="POST" action="/guild/${guildId}">
      <select name="channel_id">${options}</select>
      <button type="submit">Save</button>
    </form>
    <p><a href="/dashboard" style="color:#0ff796;">Back to servers</a></p>
  `));
});

app.use(express.urlencoded({ extended: true }));

app.post('/guild/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const guildId = req.params.id;
  try {
    // only servers this user is allowed to manage, and only a text channel that is really in that server
    if (!(await manageableGuild(req, guildId))) return res.status(403).send(page('Not allowed', '<p>You need Manage Server permission in that server.</p><a href="/dashboard">Back</a>'));
    const channelId = String(req.body.channel_id || '');
    const channels = await discordApi(`/guilds/${guildId}/channels`, { isBot: true });
    if (!isId(channelId) || !(Array.isArray(channels) ? channels : []).some(c => c.type === 0 && c.id === channelId)) {
      return res.status(400).send(page('Error', '<p>That channel isn\'t in this server.</p><a href="/dashboard">Back</a>'));
    }
    setGuildChannel(guildId, channelId);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Save failed:', err);
    res.status(500).send(page('Error', '<p>Something went wrong, try again.</p><a href="/dashboard">Back</a>'));
  }
});

const PORT = process.env.DASHBOARD_PORT || 3000;
app.listen(PORT, () => console.log(`Dashboard running on port ${PORT}`));
