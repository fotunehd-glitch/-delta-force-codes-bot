import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// FortuneHD's review page (#review-builds): list the builds players sent in, then approve or reject them.
// Approving adds the code to build-codes.txt on GitHub under the player's name, so it shows on the site
// (it also lists codes players reported as not working, with Remove / Keep)
// within about 5 minutes with no Netlify deploy. Uses the same login and GitHub token as the map editor:
//   MAP_EDIT_USER, MAP_EDIT_PASSWORD, MAP_GITHUB_TOKEN
const REPO = "fotunehd-glitch/-delta-force-codes-bot";
const FILE = "build-codes.txt";
const BRANCH = "main";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function same(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function toB64(t: string) {
  const bytes = new TextEncoder().encode(t);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function gh(path: string, token: string, init: RequestInit = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "deltaforcerandomkit-build-review",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
}

type Sub = { name: string; twitch: boolean; gun: string; code: string; build: string; at: string };
type Rep = { code: string; gun: string; by: string; count: number; first: string; last: string };

// take every line with this code out of build-codes.txt (comments are left alone)
function removeFromFile(text: string, code: string) {
  const rows = text.split(/\r?\n/);
  const kept = rows.filter((l) => { const t = l.trim(); return t.startsWith("#") || !t.toUpperCase().includes(code); });
  return kept.length === rows.length ? text : kept.join("\n");
}

// put the code at the end of the player's section, or start a new section for them at the bottom
function addToFile(text: string, s: Sub) {
  const line = `${s.gun} - ${s.code}${s.build ? ` - ${s.build}` : ""}`;
  const url = s.twitch ? `https://www.twitch.tv/${s.name.toLowerCase()}` : "";
  const rows = text.replace(/\s*$/, "").split(/\r?\n/);
  let head = -1;
  rows.forEach((l, i) => {
    const m = l.trim().match(/^\[(.+)\]$/);
    if (m && m[1].split("|")[0].trim().toLowerCase() === s.name.toLowerCase()) head = i;
  });
  if (head < 0) {
    rows.push("", url ? `[${s.name} | ${url}]` : `[${s.name}]`, line);
  } else {
    if (url && !rows[head].includes("|")) rows[head] = `[${rows[head].trim().slice(1, -1).trim()} | ${url}]`;
    let end = head;
    for (let i = head + 1; i < rows.length; i++) {
      const t = rows[i].trim();
      if (/^\[.+\]$/.test(t)) break;
      if (t && !t.startsWith("#")) end = i;
    }
    rows.splice(end + 1, 0, line);
  }
  return rows.join("\n") + "\n";
}

// Optional: BUILD_APPROVED_WEBHOOK = a Discord webhook for #build-codes, so every approved build gets posted there.
async function announce(s: Sub) {
  const hook = Netlify.env.get("BUILD_APPROVED_WEBHOOK");
  if (!hook || !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(hook)) return;
  const clean = (t: string) => t.replace(/[\\*_`~|>#\[\]()]/g, "\\$&").replace(/@/g, "@\u200b");
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [{
          title: `🔧 New build: ${s.gun}`,
          description: `\`\`\`${s.code}\`\`\`\nBy **${clean(s.name)}**\nPaste it in the gun's modify screen, or roll it on [deltaforcerandomkit.com](https://deltaforcerandomkit.com) in Build mode.`,
          color: 0x0ff796,
          footer: { text: "Got a build? Submit yours on the site" },
        }],
      }),
    });
  } catch { /* the build is on the site either way */ }
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const USER = Netlify.env.get("MAP_EDIT_USER") || "";
  const PASS = Netlify.env.get("MAP_EDIT_PASSWORD") || "";
  const TOKEN = Netlify.env.get("MAP_GITHUB_TOKEN") || "";
  if (!USER || !PASS || PASS.length < 10) return json({ error: "The login isn't set up yet (username/password missing in Netlify)." }, 503);

  let b: any;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  if (!(same(String(b?.user || ""), USER) && same(String(b?.pass || ""), PASS))) {
    await sleep(1200);
    return json({ error: "Wrong username or password" }, 401);
  }

  const subs = getStore({ name: "build-submissions", consistency: "strong" });
  const reports = getStore({ name: "build-reports", consistency: "strong" });

  if (b.action === "login" || b.action === "list") {
    const { blobs } = await subs.list();
    const list = (await Promise.all(blobs.map((x) => subs.get(x.key, { type: "json" })))).filter(Boolean) as Sub[];
    list.sort((p, q) => (p.at < q.at ? -1 : 1));
    const rb = (await reports.list()).blobs;
    const reps = (await Promise.all(rb.map((x) => reports.get(x.key, { type: "json" })))).filter(Boolean) as Rep[];
    reps.sort((p, q) => q.count - p.count || (p.first < q.first ? -1 : 1));
    return json({
      ok: true, ready: !!TOKEN,
      list: list.map(({ name, twitch, gun, code, build, at }) => ({ name, twitch, gun, code, build, at })),
      reports: reps.map(({ code, gun, by, count, first, last }) => ({ code, gun, by, count, first, last })),
    });
  }

  const code = String(b.code || "").toUpperCase();
  if (!/^[0-9A-Z]{21}$/.test(code)) return json({ error: "Bad code" }, 400);

  // reported as not working: "keep" just clears the report, "remove" takes the code off the site
  if (b.action === "keep") {
    await reports.delete(code);
    return json({ ok: true, kept: true });
  }
  if (b.action === "remove") {
    if (!TOKEN) return json({ error: "The GitHub token isn't set up in Netlify yet." }, 503);
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await gh(`contents/${FILE}?ref=${BRANCH}`, TOKEN);
      if (!cur.ok) return json({ error: `Couldn't read build-codes.txt from GitHub (${cur.status})` }, 502);
      const meta = await cur.json();
      const text = new TextDecoder().decode(Uint8Array.from(atob(String(meta.content).replace(/\n/g, "")), (c) => c.charCodeAt(0)));
      const next = removeFromFile(text, code);
      if (next === text) {
        await reports.delete(code);
        return json({ ok: true, note: "That code was already off the site" });
      }
      const put = await gh(`contents/${FILE}`, TOKEN, {
        method: "PUT",
        body: JSON.stringify({
          message: `Build codes: remove ${code} (reported not working on the site) [skip netlify]`,
          content: toB64(next),
          sha: meta.sha,
          branch: BRANCH,
        }),
      });
      if (put.ok) {
        await reports.delete(code);
        return json({ ok: true, removed: true });
      }
      if (put.status !== 409 && put.status !== 422) return json({ error: `GitHub refused the save (${put.status})` }, 502);
      await sleep(500);
    }
    return json({ error: "Someone else was saving at the same time, try again" }, 409);
  }
  const s = (await subs.get(code, { type: "json" })) as Sub | null;
  if (!s) return json({ ok: true, note: "Already dealt with" });

  if (b.action === "reject") {
    await subs.delete(code);
    return json({ ok: true, rejected: true });
  }
  if (b.action !== "approve") return json({ error: "Unknown action" }, 400);
  const gun = String(b.gun || s.gun || "").trim();
  if (!/^[A-Za-z0-9 .\-]{2,40}$/.test(gun)) return json({ error: "Pick which gun it's for first" }, 400);
  s.gun = gun;
  if (!TOKEN) return json({ error: "The GitHub token isn't set up in Netlify yet." }, 503);

  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await gh(`contents/${FILE}?ref=${BRANCH}`, TOKEN);
    if (!cur.ok) return json({ error: `Couldn't read build-codes.txt from GitHub (${cur.status})` }, 502);
    const meta = await cur.json();
    const text = new TextDecoder().decode(Uint8Array.from(atob(String(meta.content).replace(/\n/g, "")), (c) => c.charCodeAt(0)));
    if (text.includes(code)) {
      await subs.delete(code);
      return json({ ok: true, note: "That code was already on the site" });
    }
    const put = await gh(`contents/${FILE}`, TOKEN, {
      method: "PUT",
      body: JSON.stringify({
        message: `Build codes: ${s.gun} by ${s.name} (sent in on the site) [skip netlify]`,
        content: toB64(addToFile(text, s)),
        sha: meta.sha,
        branch: BRANCH,
      }),
    });
    if (put.ok) {
      await subs.delete(code);
      await announce(s);
      return json({ ok: true, approved: true });
    }
    if (put.status !== 409 && put.status !== 422) return json({ error: `GitHub refused the save (${put.status})` }, 502);
    await sleep(500);
  }
  return json({ error: "Someone else was saving at the same time, try again" }, 409);
};

export const config: Config = { path: "/api/review-builds" };
