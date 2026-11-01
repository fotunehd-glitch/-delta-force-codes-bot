import type { Context, Config } from "@netlify/functions";

// Saves map markers from the site's placing mode (#maps-edit) straight into map-markers.txt on GitHub.
// map-markers.txt is outside site/, so saving never triggers a Netlify deploy.
//
// Set these in Netlify > Project configuration > Environment variables (never in the code):
//   MAP_EDIT_USER      your editor username
//   MAP_EDIT_PASSWORD  your editor password (long and unique)
//   MAP_GITHUB_TOKEN   a fine-grained GitHub token with "Contents: Read and write" on this one repo only
const REPO = "fotunehd-glitch/-delta-force-codes-bot";
const FILE = "map-markers.txt";
const BRANCH = "main";
const MAPS = ["Zero Dam", "Layali Grove", "Space City", "Brakkesh", "Tide Prison", "AZ3 Nuclear Plant"];
const MAX_LINES = 200;

// Map | Floor | Type | X | Y | Name(optional)
const LINE =
  /^(Zero Dam|Layali Grove|Space City|Brakkesh|Tide Prison|AZ3 Nuclear Plant) \| (-|[A-Z0-9]{1,3}) \| [A-Za-z0-9 '&()\-]{1,40} \| \d{1,4}(\.\d)? \| \d{1,4}(\.\d)?( \| [^|\r\n<>]{1,80})?$/;

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

  const user = String(body?.user || ""), pass = String(body?.pass || "");
  const okUser = same(user, USER), okPass = same(pass, PASS);
  if (!(okUser && okPass)) {
    await sleep(1200); // slow down guessing
    return json({ error: "Wrong username or password" }, 401);
  }

  if (body.action === "login") return json({ ok: true, ready: !!TOKEN });
  if (body.action !== "save") return json({ error: "Unknown action" }, 400);
  if (!TOKEN) return json({ error: "Logged in, but the GitHub token isn't set up in Netlify yet." }, 503);

  const lines: string[] = Array.isArray(body.lines) ? body.lines.map((l: unknown) => String(l).trim()).filter(Boolean) : [];
  if (!lines.length) return json({ error: "Nothing to save" }, 400);
  if (lines.length > MAX_LINES) return json({ error: `Too many at once (max ${MAX_LINES})` }, 400);
  const bad = lines.filter((l) => !LINE.test(l));
  if (bad.length) return json({ error: "Some lines aren't in the right format", bad: bad.slice(0, 5) }, 400);
  for (const l of lines) {
    const [, , , x, y] = l.split(" | ");
    if (+x > 1000 || +y > 1000) return json({ error: "Positions must be between 0 and 1000", bad: [l] }, 400);
  }

  // read, append, write back (retry once if someone else saved at the same moment)
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await gh(`contents/${FILE}?ref=${BRANCH}`, TOKEN);
    if (!cur.ok) return json({ error: `Couldn't read the markers file from GitHub (${cur.status})` }, 502);
    const meta = await cur.json();
    const text = new TextDecoder().decode(Uint8Array.from(atob(String(meta.content).replace(/\n/g, "")), (c) => c.charCodeAt(0)));
    const existing = new Set(text.split(/\r?\n/).map((l) => l.trim()));
    const fresh = lines.filter((l) => !existing.has(l));
    if (!fresh.length) return json({ ok: true, saved: 0, note: "Those markers were already saved" });
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const next = text.replace(/\s*$/, "") + `\n\n# Added from the site editor ${stamp} UTC\n` + fresh.join("\n") + "\n";
    const b64 = toB64(next);
    const put = await gh(`contents/${FILE}`, TOKEN, {
      method: "PUT",
      body: JSON.stringify({ message: `Map markers: ${fresh.length} added from the site editor [skip netlify]`, content: b64, sha: meta.sha, branch: BRANCH }),
    });
    if (put.ok) return json({ ok: true, saved: fresh.length });
    if (put.status !== 409 && put.status !== 422) return json({ error: `GitHub refused the save (${put.status})` }, 502);
    await sleep(500);
  }
  return json({ error: "Someone else was saving at the same time, try again" }, 409);
};

export const config: Config = {
  path: "/api/save-markers",
};
