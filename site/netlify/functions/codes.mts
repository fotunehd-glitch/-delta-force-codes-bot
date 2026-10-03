import type { Context, Config } from "@netlify/functions";

// Same source the Discord bot uses (see fetch-codes.js in the bot repo).
// Set DOOR_CODES_API_URL in Netlify > Project configuration > Environment variables to override.
const DEFAULT_API_URL =
  "https://sg-act.playerinfinite.com/api/proxy_direct/logicial/DfTools/GetPrivateRoomKey?u=01bb74ba-b05d-4518-b244-aebe37131b35&a=10005&ts=1786532126&s=6f34bbfd32dee52e0be3f7b48d5f5c1f";

export default async (req: Request, context: Context) => {
  const maps = [
    { key: "zero_dam", name: "Zero Dam" },
    { key: "longbow_valley", name: "Layali Grove" },
    { key: "bakshe", name: "Brakkesh" },
    { key: "spaceport", name: "Space City" },
    { key: "tide_prison", name: "Tide Prison" },
    { key: "az3", name: "AZ3 Nuclear Plant" },
  ];
  const url = Netlify.env.get("DOOR_CODES_API_URL") || DEFAULT_API_URL;

  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Game API returned ${res.status}`);
    const json = await res.json();
    const data = json && json.data;
    if (!data || typeof data !== "object") throw new Error("Unexpected response shape");

    const codes = maps.map((m) => ({
      key: m.key,
      name: m.name,
      code: data[m.key] != null && String(data[m.key]).trim() !== "" ? String(data[m.key]) : null,
    }));

    return Response.json(
      { updated: new Date().toISOString(), codes },
      {
        headers: {
          "Cache-Control": "public, max-age=60",
          "Netlify-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      }
    );
  } catch (err) {
    console.error("door codes fetch failed:", err);
    return Response.json(
      { error: "Codes are unavailable right now" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
};

export const config: Config = {
  path: "/api/codes",
};
