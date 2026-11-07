import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Saves map markers from the site's placing mode (#maps-edit) straight into map-markers.txt on GitHub:
// add markers, add or change a type in the list, and remove markers or added types.
// map-markers.txt is outside site/, so saving never triggers a Netlify deploy.
//
// Set these in Netlify > Project configuration > Environment variables (never in the code):
//   MAP_EDIT_USER      your editor username
//   MAP_EDIT_PASSWORD  your editor password (long and unique)
//   MAP_GITHUB_TOKEN   a fine-grained GitHub token with "Contents: Read and write" on this one repo only
// After changing any of these, the site needs a new deploy for the function to see them.
const REPO = "fotunehd-glitch/-delta-force-codes-bot";
const FILE = "map-markers.txt";
const BRANCH = "main";
const MAPS = ["Zero Dam", "Layali Grove", "Space City", "Brakkesh", "Tide Prison", "AZ3 Nuclear Plant"];
const MAX_LINES = 200;

// Map | Floor | Type | X | Y | Name(optional)
const LINE =
  /^(Zero Dam|Layali Grove|Space City|Brakkesh|Tide Prison|AZ3 Nuclear Plant) \| (-|[A-Z0-9]{1,3}) \| [A-Za-z0-9 '&()\-]{1,40} \| \d{1,4}(\.\d)? \| \d{1,4}(\.\d)?( \| [^|\r\n<>]{1,80})?$/;

// a type or group name
const WORD = /^[A-Za-z0-9 '&()\-]{1,40}$/;
// lines the editor may delete: markers (start with a map name) and Type lines, never the notes, Icon or Picture lines
const REMOVABLE = /^((Zero Dam|Layali Grove|Space City|Brakkesh|Tide Prison|AZ3 Nuclear Plant)\s*\||Type\s*\|)/i;

// Login guessing limit: after 10 wrong passwords from one connection in an hour, logins from it are refused
// until the hour is up. Shared by the map editor and the review page (same login).
const MAX_FAILS = 10;
async function ipKey(context: Context, req: Request) {
  const ip = context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dfrk-login:" + ip));
  const h = [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h}-${Math.floor(Date.now() / 3.6e6)}`;
}

// Every login attempt first drops its own "ticket" in the store, THEN counts the tickets for this
// connection this hour. Because the ticket is written before the count, a burst of guesses sent all
// at once can't all see a low count: only the first MAX_FAILS get as far as the password check.
// A correct login removes its own ticket, so normal logins never lock you out.
async function loginGate(context: Context, req: Request) {
  const store = getStore({ name: "login-fails", consistency: "strong" });
  const prefix = (await ipKey(context, req)) + "/";
  const ticket = prefix + Date.now() + "-" + crypto.randomUUID();
  await store.set(ticket, "1");
  const { blobs } = await store.list({ prefix });
  return { blocked: blobs.length > MAX_FAILS, passed: () => store.delete(ticket) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// compare without leaking how many characters matched
function same(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// base64 of UTF-8 text, in chunks so big files don't overflow
function toB64(t: string) {
  const bytes = new TextEncoder().encode(t);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function gh(path: string, token: string, init: RequestInit = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "deltaforcerandomkit-map-editor",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const USER = Netlify.env.get("MAP_EDIT_USER") || "";
  const PASS = Netlify.env.get("MAP_EDIT_PASSWORD") || "";
  const TOKEN = Netlify.env.get("MAP_GITHUB_TOKEN") || "";
  if (!USER || !PASS || PASS.length < 10) return json({ error: "The map editor isn't set up yet (username/password missing in Netlify)." }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  const gate = await loginGate(context, req);
  if (gate.blocked) return json({ error: "Too many wrong passwords. Try again in an hour." }, 429);

  const user = String(body?.user || ""), pass = String(body?.pass || "");
  const okUser = same(user, USER), okPass = same(pass, PASS);
  if (!(okUser && okPass)) {
    await sleep(1200); // slow down guessing
    return json({ error: "Wrong username or password" }, 401);
  }
  await gate.passed();

  if (body.action === "login") return json({ ok: true, ready: !!TOKEN });
  if (!["save", "addtype", "remove"].includes(body.action)) return json({ error: "Unknown action" }, 400);
  if (!TOKEN) return json({ error: "Logged in, but the GitHub token isn't set up in Netlify yet." }, 503);

  // ---- add markers: append new lines at the bottom
  if (body.action === "save") {
    const lines: string[] = Array.isArray(body.lines) ? body.lines.map((l: unknown) => String(l).trim()).filter(Boolean) : [];
    if (!lines.length) return json({ error: "Nothing to save" }, 400);
    if (lines.length > MAX_LINES) return json({ error: `Too many at once (max ${MAX_LINES})` }, 400);
    const bad = lines.filter((l) => !LINE.test(l));
    if (bad.length) return json({ error: "Some lines aren't in the right format", bad: bad.slice(0, 5) }, 400);
    for (const l of lines) {
      const [, , , x, y] = l.split(" | ");
      if (+x > 1000 || +y > 1000) return json({ error: "Positions must be between 0 and 1000", bad: [l] }, 400);
    }
    return update(TOKEN, (text) => {
      const existing = new Set(text.split(/\r?\n/).map((l) => l.trim()));
      const fresh = lines.filter((l) => !existing.has(l));
      if (!fresh.length) return { reply: { ok: true, saved: 0, note: "Those markers were already saved" } };
      const next = text.replace(/\s*$/, "") + `\n\n# Added from the site editor ${stamp()} UTC\n` + fresh.join("\n") + "\n";
      return { next, message: `Map markers: ${fresh.length} added from the site editor [skip netlify]`, reply: { ok: true, saved: fresh.length } };
    });
  }

  // ---- add a type to the list:  Type | Name | Group | #colour | Letters
  if (body.action === "addtype") {
    const t = body.type || {};
    const name = String(t.name || "").trim().replace(/\s+/g, " ");
    const group = String(t.group || "").trim().replace(/\s+/g, " ") || "Other";
    const colour = String(t.colour || "").trim().toLowerCase();
    const letters = String(t.letters || "").trim() || name.slice(0, 1).toUpperCase();
    if (!WORD.test(name)) return json({ error: "Type name: up to 40 letters, numbers, spaces and - ' & ( )" }, 400);
    if (!WORD.test(group)) return json({ error: "Group: up to 40 letters, numbers, spaces and - ' & ( )" }, 400);
    if (!/^#[0-9a-f]{6}$/.test(colour)) return json({ error: "Pick a colour" }, 400);
    if (!/^[A-Za-z0-9#$!?+&£*@%]{1,3}$/.test(letters)) return json({ error: "Letters: 1 to 3 letters or numbers" }, 400);
    const line = `Type | ${name} | ${group} | ${colour} | ${letters}`;
    return update(TOKEN, (text) => {
      const rows = text.split(/\r?\n/);
      const same = rows.findIndex((l) => { const p = l.split("|").map((x) => x.trim()); return /^type$/i.test(p[0]) && (p[1] || "").toLowerCase() === name.toLowerCase(); });
      if (same >= 0 && rows[same].trim() === line) return { reply: { ok: true, saved: 0, line, note: `${name} is already in the list` } };
      if (same >= 0) rows[same] = line; // changing an existing type's group, colour or letters
      else {
        // keep type lines together near the top, so they come before any markers that use them
        let at = -1;
        rows.forEach((l, i) => { if (/^type\s*\|/i.test(l.trim())) at = i; });
        if (at < 0) rows.forEach((l, i) => { if (/^icon\s*\|/i.test(l.trim())) at = i; });
        if (at < 0) { rows.push("", line); } else rows.splice(at + 1, 0, line);
      }
      return { next: rows.join("\n"), message: `Map markers: type "${name}" ${same >= 0 ? "changed" : "added"} from the site editor [skip netlify]`, reply: { ok: true, saved: 1, line } };
    });
  }

  // ---- remove markers (or added types): delete those exact lines
  const lines: string[] = Array.isArray(body.lines) ? body.lines.map((l: unknown) => String(l).trim()).filter(Boolean) : [];
  if (!lines.length) return json({ error: "Nothing to remove" }, 400);
  if (lines.length > MAX_LINES) return json({ error: `Too many at once (max ${MAX_LINES})` }, 400);
  const bad = lines.filter((l) => !REMOVABLE.test(l));
  if (bad.length) return json({ error: "Only marker lines and type lines can be removed", bad: bad.slice(0, 5) }, 400);
  const gone = new Set(lines);
  return update(TOKEN, (text) => {
    const rows = text.split(/\r?\n/);
    let keep = rows.filter((l) => !gone.has(l.trim()));
    const n = rows.length - keep.length;
    // tidy up: drop "# Added from the site editor" notes that no longer have any markers under them
    keep = keep.filter((l, i) => {
      if (!/^# Added from the site editor/.test(l)) return true;
      const nxt = keep.slice(i + 1).find((x) => x.trim());
      return !!nxt && !nxt.trim().startsWith("#");
    }).join("\n").replace(/\n{3,}/g, "\n\n").split("\n");
    if (!n) return { reply: { ok: true, removed: 0, note: "Already removed" } };
    return { next: keep.join("\n").replace(/\n+$/, "") + "\n", message: `Map markers: ${n} removed from the site editor [skip netlify]`, reply: { ok: true, removed: n } };
  });
};

const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");

type Change = { next?: string; message?: string; reply: Record<string, unknown> };

// read the file, change it, write it back (retry once if someone else saved at the same moment)
async function update(token: string, change: (text: string) => Change) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await gh(`contents/${FILE}?ref=${BRANCH}`, token);
    if (!cur.ok) return json({ error: `Couldn't read the markers file from GitHub (${cur.status})` }, 502);
    const meta = await cur.json();
    const text = new TextDecoder().decode(Uint8Array.from(atob(String(meta.content).replace(/\n/g, "")), (c) => c.charCodeAt(0)));
    const r = change(text);
    if (r.next === undefined) return json(r.reply);
    const put = await gh(`contents/${FILE}`, token, {
      method: "PUT",
      body: JSON.stringify({ message: r.message, content: toB64(r.next), sha: meta.sha, branch: BRANCH }),
    });
    if (put.ok) return json(r.reply);
    if (put.status !== 409 && put.status !== 422) return json({ error: `GitHub refused the save (${put.status})` }, 502);
    await sleep(500);
  }
  return json({ error: "Someone else was saving at the same time, try again" }, 409);
}

export const config: Config = {
  path: "/api/save-markers",
};
