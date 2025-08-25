#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', 'dist');
const port = parseInt(process.env.PORT || '8080', 10);

const types = new Map(Object.entries({
  '.html':'text/html; charset=utf-8',
  '.htm':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.mjs':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.webp':'image/webp',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml',
  '.ico':'image/x-icon'
}));

function safeJoin(base, target){
  const resolved = path.resolve(base, target);
  if (!resolved.startsWith(base)) return base; // prevent path escape
  return resolved;
}

async function exists(p){
  try{ await fsp.access(p, fs.constants.R_OK); return true; } catch { return false; }
}

const server = http.createServer(async (req, res)=>{
  try{
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    let p = decodeURIComponent(parsed.pathname || '/');
    // Normalize leading/trailing slashes and default document
    if (p.startsWith('/')) p = p.slice(1);
    if (p === '') p = 'index.html';
    if (p.endsWith('/')) p += 'index.html';

    let filePath = safeJoin(root, p);

    // If the resolved path is a directory, try index.html inside it
    try {
      const st = await fsp.stat(filePath);
      if (st.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {}

    const ok = await exists(filePath);
    if (!ok){ res.writeHead(404, { 'content-type':'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const type = types.get(ext) || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache, no-store, must-revalidate' });
    fs.createReadStream(filePath).on('error', err=>{
      res.writeHead(500, { 'content-type':'text/plain; charset=utf-8' });
      res.end(String(err));
    }).pipe(res);
  } catch (err){
    res.writeHead(500, { 'content-type':'text/plain; charset=utf-8' });
    res.end(String(err));
  }
});

server.listen(port, ()=>{
  console.log(`Preview server running at http://localhost:${port}/ (serving ${root})`);
});

