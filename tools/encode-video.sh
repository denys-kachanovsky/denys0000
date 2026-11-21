#!/usr/bin/env bash
# Usage: tools/encode-video.sh <input.(mp4|mov|...)> <name> [max_fps]
# Produces assets/video/<name>.mp4 (H.264, full resolution, CRF 18, no audio, faststart)
# and assets/video/<name>.jpg (first frame, used as poster).
set -euo pipefail
in="$1"; name="$2"; fps="${3:-}"
out="$(dirname "$0")/../assets/video"
mkdir -p "$out"
ffmpeg -hide_banner -loglevel error -y -i "$in" -an \
  -c:v libx264 -preset slow -crf 18 -profile:v high -pix_fmt yuv420p \
  ${fps:+-r "$fps"} -movflags +faststart -tag:v avc1 "$out/$name.mp4"
ffmpeg -hide_banner -loglevel error -y -i "$in" -frames:v 1 -q:v 2 "$out/$name.jpg"
ls -lh "$out/$name".{mp4,jpg}
