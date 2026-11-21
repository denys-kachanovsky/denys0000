# d-kachanovsky — static site

Pure HTML + CSS + a tiny JS file. No build step, no framework.

```
index.html                     home (project list)
happ/ gps-tracker/ petcube-e-commerce/ emergency-fund/   project pages (index.html in each)
assets/css/style.css           Webflow export, untouched (only font URLs made local)
assets/css/custom.css          hand-written additions (entrance animation)
assets/js/main.js              entrance animation + muted video autoplay
assets/img  assets/video  assets/fonts
```

## Preview locally
    python3 -m http.server 8000      # then open http://localhost:8000

## Publish
Upload the folder to any static host (Cloudflare Pages, Netlify, Vercel, GitHub Pages, own server).
Paths are root-absolute (`/assets/...`), so serve it from the domain root.

## Adding a video
    tools/encode-video.sh ~/Downloads/original.mov my-video-name [max_fps]
Needs `ffmpeg`. Creates `assets/video/my-video-name.mp4` (full resolution, visually lossless) and a `.jpg` poster.
Copy an existing `<div class="background-video ...">` block from `happ/index.html` and change the file names.

## Known leftovers
- 11 videos on gps-tracker / petcube-e-commerce / emergency-fund still point to Dropbox links.
  Download them into `assets/video/` and change the `src` to `/assets/video/<file>.mp4`.
- Webflow's default favicon was not copied; add `<link rel="icon" href="/favicon.ico">` when you have one.
