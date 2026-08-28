// db.js
// Tiny JSON-file-backed store: one entry per Discord server (guild),
// recording which channel it wants the daily door codes posted into.
// Uses a plain JSON file instead of a database - no native compilation
// needed, which keeps the Docker build simple and reliable.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'guilds.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readData() {
  if (!fs.existsSync(DB_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeData(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function setGuildChannel(guildId, channelId) {
  const data = readData();
  data[guildId] = { channel_id: channelId, updated_at: new Date().toISOString() };
  writeData(data);
}

function getGuildChannel(guildId) {
  const data = readData();
  return data[guildId] ? data[guildId].channel_id : null;
}

function getAllConfiguredGuilds() {
  const data = readData();
  return Object.entries(data).map(([guild_id, v]) => ({ guild_id, channel_id: v.channel_id }));
}

function removeGuild(guildId) {
  const data = readData();
  delete data[guildId];
  writeData(data);
}

module.exports = { setGuildChannel, getGuildChannel, getAllConfiguredGuilds, removeGuild };
