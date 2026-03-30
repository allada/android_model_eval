#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/widget/videos"

for f in "$DIR"/*.mkv; do
  [ -f "$f" ] || continue
  mp4="${f%.mkv}.mp4"
  if [ -f "$mp4" ]; then
    echo "Skipping $(basename "$f") (mp4 exists)"
    continue
  fi
  echo "Converting $(basename "$f")..."
  ffmpeg -i "$f" -c:v libx264 -preset fast -crf 23 -movflags +faststart -an "$mp4"
  echo "  -> $(basename "$mp4")"
done

echo "Done."
