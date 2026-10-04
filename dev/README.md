# Site source (not published)

- `hawk-roll.src.html` is the page source; images are injected at `/*IMGDATA*/` from `mh/img.js`.
- Run `python3 build.py` here to produce `hawk-roll.html` (all-in-one preview) and `site/index.html` + `site/img/` (live build). Copy those into `../site/`.
- Netlify only publishes `site/`, so this folder never goes live.
