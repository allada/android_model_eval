#!/usr/bin/env bun
// Static file server with HTTP Range request support for video seeking.
import { statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = import.meta.dir;
const PORT = Number(process.env.PORT ?? 8200);

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".css": "text/css",
};

Bun.serve({
  hostname: '0.0.0.0',
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = join(ROOT, decodeURIComponent(url.pathname));

    // Prevent path traversal
    if (!path.startsWith(ROOT)) return new Response("Forbidden", { status: 403 });

    let stat;
    try { stat = statSync(path); } catch { return new Response("Not Found", { status: 404 }); }
    if (!stat.isFile()) return new Response("Not Found", { status: 404 });

    const size = stat.size;
    const mime = MIME[extname(path)] ?? "application/octet-stream";
    const rangeHeader = req.headers.get("range");

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (!match) return new Response("Bad Range", { status: 416 });
      const start = match[1] ? parseInt(match[1]) : 0;
      const end = match[2] ? parseInt(match[2]) : size - 1;
      const chunkSize = end - start + 1;

      const file = Bun.file(path);
      const slice = file.slice(start, end + 1);
      return new Response(slice, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(chunkSize),
          "Accept-Ranges": "bytes",
        },
      });
    }

    return new Response(Bun.file(path), {
      headers: {
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Content-Length": String(size),
      },
    });
  },
});

console.log(`Serving http://localhost:${PORT}/player-mobile.html`);
