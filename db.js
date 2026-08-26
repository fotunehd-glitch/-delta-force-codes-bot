// db.js
// Tiny SQLite-backed store: one row per Discord server (guild), recording
// which channel it wants the daily door codes posted into.

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'guilds.db');

const fs = require('fs');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_configs (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

function setGuildChannel(guildId, channelId) {
  db.prepare(`
    INSERT INTO guild_configs (guild_id, channel_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, updated_at = excluded.updated_at
  `).run(guildId, channelId, new Date().toISOString());
}

function getGuildChannel(guildId) {
  const row = db.prepare('SELECT channel_id FROM guild_configs WHERE guild_id = ?').get(guildId);
  return row ? row.channel_id : null;
}

function getAllConfiguredGuilds() {
  return db.prepare('SELECT guild_id, channel_id FROM guild_configs').all();
}

function removeGuild(guildId) {
  db.prepare('DELETE FROM guild_configs WHERE guild_id = ?').run(guildId);
}

module.exports = { setGuildChannel, getGuildChannel, getAllConfiguredGuilds, removeGuild };
