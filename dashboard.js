// dashboard.js
// Small website: "Login with Discord", pick a mutual server, choose a
// channel, save. Runs as its own web server alongside the bot process.

const express = require('express');
const session = require('express-session');
const https = require('https');

const { setGuildChannel, getGuildChannel } = require('./db.js');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3000';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret';
const REDIRECT_URI = `${PUBLIC_URL}/callback`;

const app = express();
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false }));

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
<html><head><meta charset="UTF-8"><title>${title}</title>
<style>
  body { background:#0a0e14; color:#fff; font-family:Arial, sans-serif; max-width:640px; margin:60px auto; padding:0 20px; }
  h1 { color:#0ff796; }
  a.btn, button { background:#0ff796; color:#0a0e14; border:none; padding:10px 18px; border-radius:6px; font-weight:bold; text-decoration:none; cursor:pointer; font-size:15px; }
  .card { background:#111826; border:1px solid #2ee6ff; border-radius:8px; padding:16px; margin:10px 0; display:flex; justify-content:space-between; align-items:center; }
  select { padding:8px; border-radius:6px; }
</style></head><body>${body}</body></html>`;
}

// --- Routes ---

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  const authUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
  res.send(page('Delta Force Door Codes', `
    <h1>Delta Force Door Codes</h1>
    <p>Add the bot to your server, then log in here to pick which channel gets the daily codes.</p>
    <a class="btn" href="${authUrl}">Login with Discord</a>
  `));
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/');

  try {
    const tokenData = await exchangeCodeForToken(code);
    const user = await discordApi('/users/@me', { token: tokenData.access_token });
    req.session.user = user;
    req.session.accessToken = tokenData.access_token;
    res.redirect('/dashboard');
  } catch (err) {
    res.status(500).send(page('Error', `<p>Login failed: ${err.message}</p><a href="/">Try again</a>`));
  }
});

app.get('/dashboard', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const userGuilds = await discordApi('/users/@me/guilds', { token: req.session.accessToken });
  const botGuilds = await discordApi('/users/@me/guilds', { isBot: true });
  const botGuildIds = new Set((botGuilds || []).map(g => g.id));

  // Only show servers where the user can manage the server AND the bot is present
  const MANAGE_GUILD = 0x20;
  const mutual = (userGuilds || []).filter(g =>
    botGuildIds.has(g.id) && (g.permissions & MANAGE_GUILD) === MANAGE_GUILD
  );

  const list = mutual.map(g => `
    <div class="card">
      <span>${g.name}</span>
      <a class="btn" href="/guild/${g.id}">Configure</a>
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

  const channels = await discordApi(`/guilds/${guildId}/channels`, { isBot: true });
  const textChannels = (channels || []).filter(c => c.type === 0);
  const current = getGuildChannel(guildId);

  const options = textChannels.map(c =>
    `<option value="${c.id}" ${c.id === current ? 'selected' : ''}>#${c.name}</option>`
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

app.post('/guild/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  setGuildChannel(req.params.id, req.body.channel_id);
  res.redirect('/dashboard');
});

const PORT = process.env.DASHBOARD_PORT || 3000;
app.listen(PORT, () => console.log(`Dashboard running on port ${PORT}`));
