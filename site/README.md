# deltaforce-site

FortuneHD's Delta Force Random Loadouts + today's door codes.
Live at https://deltaforcerandomkit.com (Netlify, deployed from this repo). The old address deltaforcedoorcodebot.online still works and 301-redirects here.

- `index.html` — the whole site (randomiser, door codes panel, Add to Discord button)
- `netlify/functions/codes.mts` — serves today's door codes at `/api/codes`, cached for 5 minutes.
  Uses the same game API as the Discord bot. To change the source without editing code,
  set `DOOR_CODES_API_URL` in Netlify > Project configuration > Environment variables.
