#!/bin/bash
set -e

SRC_DIR="./widget/data"
S3_BUCKET="s3://blaise-bruer-public/android-emulator-blog/data"
TMP_DIR=$(mktemp -d)

echo "Compressing and uploading files from $SRC_DIR to $S3_BUCKET ..."

for f in "$SRC_DIR"/*.json; do
  fname=$(basename "$f")
  gzip -c "$f" > "$TMP_DIR/$fname"
done

# Upload all gzipped files with correct headers
aws s3 sync "$TMP_DIR/" "$S3_BUCKET/" \
  --content-encoding gzip \
  --content-type "application/json" \
  --cache-control "public, max-age=86400"

rm -rf "$TMP_DIR"

echo "Done. Uploaded $(ls "$SRC_DIR"/*.json | wc -l) files."
