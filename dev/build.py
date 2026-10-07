"""Build both outputs from hawk-roll.src.html:
- hawk-roll.html  : artifact page (images inlined)
- site/index.html : standalone page for Netlify
"""
import re

src = open('hawk-roll.src.html').read()
full = src.replace("/*IMGDATA*/", open('mh/img.js').read())
open('hawk-roll.html', 'w').write(full.replace('fetch("/api/codes"', 'fetch("https://deltaforcerandomkit.com/api/codes"'))

i = full.index('</style>') + len('</style>')
head, body = full[:i], full[i:]
head = head.replace('<style>', '<style>\nhtml,body{margin:0}[hidden]{display:none!important}img{max-width:100%}', 1)
desc = "Free Delta Force random loadout generator and randomizer for Operations. Spin a random operator, map, weapon and gear, spin the wheel for difficulty, mod budget and ammo, and get today's door codes. Season 11."
out = (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    f'<meta name="description" content="{desc}">\n'
    + head + '\n</head>\n<body>\n' + body + '\n</body>\n</html>\n'
)
# --- split images out into cached files for the live site ---
import json, base64, hashlib, os, shutil
imgs = json.loads(open('mh/img.js').read().strip()[len('const IMG='):].rstrip(';'))
if os.path.isdir('site/img'): shutil.rmtree('site/img')
os.makedirs('site/img')
paths = {}
for name, uri in imgs.items():
    data = base64.b64decode(uri.split(',', 1)[1])
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    fn = f"{slug}-{hashlib.sha1(data).hexdigest()[:8]}.webp"
    open('site/img/' + fn, 'wb').write(data)
    paths[name] = '/img/' + fn
small = out.replace(open('mh/img.js').read(), 'const IMG=' + json.dumps(paths, separators=(',', ':')) + ';')
assert small != out, 'image map not replaced'
# warm the browser cache with every picture once the page is idle, so first spins never show blanks
small = small.replace('buildReels();buildSettings();', 'buildReels();buildSettings();setTimeout(()=>{const q=Object.values(IMG);let i=0;const nx=()=>{if(i>=q.length)return;const im=new Image();im.decoding="async";im.onload=im.onerror=nx;im.src=q[i++]};for(let k=0;k<6;k++)nx()},800);', 1)
open('site/index.html', 'w').write(small)
print('site page', round(len(small) / 1024), 'KB +', len(paths), 'images', round(sum(os.path.getsize('site/img/'+f) for f in os.listdir('site/img'))/1024), 'KB')
open('t.js', 'w').write(re.search(r'<script>(.*)</script>', src, re.S).group(1))
print('built', round(len(out) / 1024), 'KB')
