// fetch-codes.js
// Shared logic for pulling the current door codes from the game's API.

const https = require('https');

const API_URL = "https://sg-act.playerinfinite.com/api/proxy_direct/logicial/DfTools/GetPrivateRoomKey?u=01bb74ba-b05d-4518-b244-aebe37131b35&a=10005&ts=1786532126&s=6f34bbfd32dee52e0be3f7b48d5f5c1f";

const MAPS = [
  { key: "zero_dam",       name: "Zero Dam" },
  { key: "bakshe",         name: "Bakshe" },
  { key: "longbow_valley", name: "Longbow Valley" },
  { key: "spaceport",      name: "Space City" },
  { key: "tide_prison",    name: "Tide Prison" },
  { key: "az3",            name: "AZ3" },
];

function fetchCodes() {
  return new Promise((resolve, reject) => {
    https.get(API_URL, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json && json.data) {
            resolve(json.data);
          } else {
            reject(new Error('Unexpected response shape'));
          }
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

function buildEmbed(codes) {
  const fields = MAPS.map(m => ({
    name: m.name,
    value: `\`${codes[m.key] || '----'}\``,
    inline: true,
  }));

  return {
    title: "Delta Force Door Codes",
    color: 0x0ff796,
    fields: fields,
    timestamp: new Date().toISOString(),
    footer: { text: "Made by FortuneHD - auto-updated daily" },
  };
}

module.exports = { fetchCodes, buildEmbed, MAPS };
