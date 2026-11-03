import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Players submit a build code from the "Submit your build" pop-up in Build mode.
// Submissions wait in a Netlify Blobs store until FortuneHD approves them on #review-builds
// (see review-builds.mts). Nothing goes on the site without approval.
//
// Optional: set BUILD_SUBMIT_WEBHOOK in Netlify > Environment variables to a Discord webhook URL
// to get a message when a new build comes in.
const BUILD_FILE_URL = "https://raw.githubusercontent.com/fotunehd-glitch/-delta-force-codes-bot/main/build-codes.txt";
const MAX_PENDING = 200; // stop accepting new ones if this many are waiting
const PER_HOUR = 5; // submissions per person per hour

const NAME = /^[A-Za-z0-9_][A-Za-z0-9_ .\-]{1,24}$/;
const TWITCH = /^[A-Za-z0-9_]{3,25}$/;
const GUN = /^[A-Za-z0-9 .\-]{2,40}$/;
const CODE = /^[0-9A-Z]{21}$/;
const BUILD = /^[A-Za-z0-9 '&()+.,\-]{1,30}$/;
const RESERVED = /^(players?|discord|community|poach|fortunehd)$/i;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function hash(t: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dfrk:" + t));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  // bots fill in the hidden "website" box; pretend it worked
  if (b?.website) return json({ ok: true });

  const name = String(b?.name || "").trim().replace(/\s+/g, " ");
  const twitch = !!b?.twitch;
  const gun = String(b?.gun || "").trim();
  const code = String(b?.code || "").trim().toUpperCase();
  const build = String(b?.build || "").trim().replace(/\s+/g, " ");

  if (!NAME.test(name)) return json({ error: "Name: 2 to 25 letters, numbers, spaces, _ . or -" }, 400);
  if (RESERVED.test(name)) return json({ error: "Please use your own Twitch or in-game name" }, 400);
  if (twitch && !TWITCH.test(name)) return json({ error: "That doesn't look like a Twitch name (letters, numbers and _ only)" }, 400);
  if (!GUN.test(gun)) return json({ error: "Pick the gun" }, 400);
  if (!CODE.test(code)) return json({ error: "That doesn't look like a build code (21 letters and numbers)" }, 400);
  if (build && !BUILD.test(build)) return json({ error: "Build name: up to 30 letters, numbers and spaces" }, 400);

  const subs = getStore({ name: "build-submissions", consistency: "strong" });
  const rates = getStore({ name: "build-submit-rate", consistency: "strong" });

  // a few per person per hour
  const who = await hash(context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown");
  const hour = Math.floor(Date.now() / 3.6e6);
  const rk = `${who}-${hour}`;
  const used = Number((await rates.get(rk)) || 0);
  if (used >= PER_HOUR) return json({ error: "That's a lot of builds! Try again in an hour." }, 429);

  // already waiting, or already on the site?
  if (await subs.get(code)) return json({ error: "That build code has already been sent in and is waiting to be checked" }, 409);
  try {
    const r = await fetch(BUILD_FILE_URL + "?v=" + Date.now());
    if (r.ok && (await r.text()).includes(code)) return json({ error: "That build code is already on the site" }, 409);
  } catch { /* GitHub unreachable: FortuneHD will spot a repeat when approving */ }

  const { blobs } = await subs.list();
  if (blobs.length >= MAX_PENDING) return json({ error: "Lots of builds are waiting to be checked right now. Please try again later." }, 503);

  await rates.set(rk, String(used + 1));
  await subs.setJSON(code, { name, twitch, gun, code, build, at: new Date().toISOString(), who });

  const hook = Netlify.env.get("BUILD_SUBMIT_WEBHOOK");
  if (hook && /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(hook)) {
    const clean = (t: string) => t.replace(/[\\*_`~|>#\[\]()]/g, "\\$&").replace(/@/g, "@\u200b");
    try {
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `New build sent in: **${clean(gun)}**${build ? ` (${clean(build)})` : ""} by ${clean(name)}${twitch ? " (Twitch)" : ""}\nCheck it: https://deltaforcerandomkit.com/#review-builds`,
          allowed_mentions: { parse: [] },
        }),
      });
    } catch { /* the build is saved either way */ }
  }
  return json({ ok: true });
};

export const config: Config = { path: "/api/submit-build" };
