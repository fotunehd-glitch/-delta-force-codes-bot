import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Players report a build code that doesn't work in game ("Code not working?" under the build code).
// Reports wait in a Netlify Blobs store until FortuneHD removes the code or keeps it on #review-builds
// (see review-builds.mts). Nothing is removed from the site automatically.
//
// Optional: BUILD_SUBMIT_WEBHOOK (the same Discord webhook as new builds) gets a message for each new report.
const BUILD_FILE_URL = "https://raw.githubusercontent.com/fotunehd-glitch/-delta-force-codes-bot/main/build-codes.txt";
const PER_HOUR = 10; // reports per person per hour
const MAX_OPEN = 300; // stop accepting new reports if this many are waiting

const CODE = /^[0-9A-Z]{21}$/;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function hash(t: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dfrk:" + t));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// which gun and creator a code belongs to in build-codes.txt
function findInFile(text: string, code: string) {
  let sec = "POACH";
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    const m = l.match(/^\[(.+)\]$/);
    if (m) { sec = m[1].split("|")[0].trim(); continue; }
    if (!l || l.startsWith("#")) continue;
    if (l.toUpperCase().includes(code)) return { gun: l.split(" - ")[0].trim().slice(0, 60), by: sec.slice(0, 40) };
  }
  return null;
}

export type Report = { code: string; gun: string; by: string; count: number; first: string; last: string; who: string[] };

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  if (b?.website) return json({ ok: true }); // bots fill in the hidden box

  // accept the code on its own or the whole line pasted from the game
  const m = String(b?.code || "").toUpperCase().match(/(?:^|[^0-9A-Z])([0-9A-Z]{21})(?![0-9A-Z])/);
  const code = m ? m[1] : "";
  if (!CODE.test(code)) return json({ error: "That doesn't look like a build code (21 letters and numbers)" }, 400);

  let text = "";
  try {
    const r = await fetch(BUILD_FILE_URL + "?v=" + Date.now());
    if (r.ok) text = await r.text();
  } catch { /* GitHub unreachable: still take the report */ }
  const found = text ? findInFile(text, code) : null;
  if (text && !found) return json({ error: "That code isn't on the site (it may already have been removed)" }, 404);

  const reports = getStore({ name: "build-reports", consistency: "strong" });
  const rates = getStore({ name: "build-report-rate", consistency: "strong" });

  const who = await hash(context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown");
  const rk = `${who}-${Math.floor(Date.now() / 3.6e6)}`;
  const used = Number((await rates.get(rk)) || 0);
  if (used >= PER_HOUR) return json({ error: "That's a lot of reports! Try again in an hour." }, 429);

  const now = new Date().toISOString();
  const old = (await reports.get(code, { type: "json" })) as Report | null;
  if (old) {
    if (old.who.includes(who)) return json({ ok: true, note: "You've already reported this one, thanks" });
    old.count += 1; old.last = now; old.who = old.who.concat(who).slice(-50);
    await rates.set(rk, String(used + 1));
    await reports.setJSON(code, old);
    return json({ ok: true });
  }
  const { blobs } = await reports.list();
  if (blobs.length >= MAX_OPEN) return json({ error: "Lots of reports are waiting to be checked right now. Please try again later." }, 503);

  const rep: Report = { code, gun: found?.gun || "", by: found?.by || "", count: 1, first: now, last: now, who: [who] };
  await rates.set(rk, String(used + 1));
  await reports.setJSON(code, rep);

  const hook = Netlify.env.get("BUILD_SUBMIT_WEBHOOK");
  if (hook && /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(hook)) {
    const clean = (t: string) => t.replace(/[\\*_`~|>#\[\]()]/g, "\\$&").replace(/@/g, "@\u200b");
    try {
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `⚠️ Build code reported as not working: \`${code}\`${rep.gun ? ` (${clean(rep.gun)}${rep.by ? ` by ${clean(rep.by)}` : ""})` : ""}\nCheck it: https://deltaforcerandomkit.com/#review-builds`,
          allowed_mentions: { parse: [] },
        }),
      });
    } catch { /* the report is saved either way */ }
  }
  return json({ ok: true });
};

export const config: Config = { path: "/api/report-build" };
