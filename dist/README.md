# Divi Catalog — dist/

This folder contains the final, publish-ready catalog outputs and a minimal viewer UI.
You can host this directory on any static web server or CDN.

## What’s inside
- manifest.json — the complete catalog data (packs, pages, thumbnail URLs)
- thumbs/ — WebP thumbnails organized by category
- index.html, styles.css, app.js — a zero-dependency viewer for the catalog

Notes
- Some pages may not have a thumbnail (depending on availability at capture time). The viewer and consumers should treat `thumbnail` as optional.
- No build step is required to use the viewer; it’s plain HTML/CSS/JS.

## Using the data (programmatic)
Fetch manifest.json and iterate items:
- GET ./manifest.json (relative) or an absolute URL if hosted elsewhere
- Each item is a “pack” with an array of `pages[]`; each page has `layout_slug`, `demo_url`, `layout_url`, optional `thumbnail`

Example pseudocode
- JS (browser/Node): `const data = await fetch('manifest.json').then(r=>r.json())`
- Python: `requests.get('.../manifest.json').json()`

Thumbnails
- Paths in `thumbnail` are absolute URLs (e.g., GitHub Pages) for easy hotlinking
- If you deploy dist/ to a different host/CDN and want local thumbnail URLs, you can rewrite them during publish (see SPECS/config.json in repo root)

## Viewing locally
Because browsers restrict file:// XHR, serve dist/ over HTTP.

Options (pick one):
1) Node (no install beyond Node itself)
   - `npx serve dist`
   - or `npx http-server dist -p 8080`
   - Open http://localhost:8080

2) Python
   - Python 3: `python -m http.server 8080 --directory dist`
   - Open http://localhost:8080

3) Docker (Nginx)
   - `docker run --rm -p 8080:80 -v "${PWD}/dist:/usr/share/nginx/html:ro" nginx:alpine`
   - Open http://localhost:8080

## Deploying to a different environment
- Any static host (Netlify, Vercel static, Cloudflare Pages, S3+CloudFront, GCS, Azure Static Web Apps, Apache/Nginx) can serve dist/ as-is
- Place the contents of dist/ at your web root
- Ensure the MIME types are served correctly (JSON, WebP, CSS, JS)

CDN base URL considerations
- If you move hosting, the viewer loads `./manifest.json` relative to the current origin; no changes needed
- If your manifest’s `thumbnail` fields still point to GitHub Pages, you can:
  - keep them as-is (hotlink), or
  - regenerate/publish with SPECS/config.json `cdn.baseUrl` set to your new host so thumbnails point to your CDN

## Troubleshooting
- 404 for manifest.json — ensure it’s deployed next to index.html
- Thumbnails not loading — verify the `thumbs/` folder is uploaded and the URLs in manifest.json match your host
- Opening index.html by double-click shows a blank grid — serve over HTTP (see Viewing locally)

## Rebuilding data (for maintainers)
- See repository README for the pipeline commands:
  - `npm run discover` → data/work/discovered.json
  - `npm run thumbs` → dist/thumbs/* and updates to discovered.json
  - `npm run publish` → dist/manifest.json (rewrites thumbnail URLs using SPECS/config.json)
  - `npm run validate` → schema check

## Is 100% of the catalog here?
Yes — the published outputs the apps need are entirely in dist/: the manifest and the thumbnails. Intermediate crawl/enrichment artifacts live in data/work/ (ignored in git) and are not required for consumers. The viewer assets are also in dist/ for self-contained hosting.

