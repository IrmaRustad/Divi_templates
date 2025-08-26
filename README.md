# Divi Live‑Demo Catalog Pipeline

This repo builds a manifest of Divi live demo pages, generates thumbnails, and validates the output for a client‑facing template picker.

## Live
- Catalog UI: https://irmarustad.github.io/Divi_templates/
- Manifest JSON: https://irmarustad.github.io/Divi_templates/manifest.json
- Thumbnails: https://irmarustad.github.io/Divi_templates/thumbs/<category>/<layout_slug>.webp
- Permanent snapshot (release): https://github.com/IrmaRustad/Divi_templates/releases — we will publish v1.0.0 so you have an immutable URL like:
  - https://raw.githubusercontent.com/IrmaRustad/Divi_templates/v1.0.0/dist/manifest.json


## Requirements
- Node.js 20+
- Windows/Linux/macOS

## Install
```sh
npm ci
npm run setup    # installs Playwright Chromium (and deps on Linux)
```

## Commands
```sh
npm run discover   # gather/seed discovered data -> data/work/discovered.json
npm run thumbs     # render thumbnails -> dist/thumbs/* and set relative paths in discovered.json
npm run enrich     # fill facets in data/work/discovered.json (placeholder for now)
npm run publish    # write dist/manifest.json (rewrites thumbs to http(s) using SPECS/config.json)
npm run validate   # validate dist/manifest.json against SPECS/manifest.schema.json
npm run check-links# link health check (stub)
```

## Outputs
- data/work/discovered.json  (intermediate; thumbnails stored as relative paths e.g. `thumbs/<category>/<layout_slug>.webp`)
- dist/thumbs/*              (WebP thumbnails)
- dist/manifest.json         (final manifest; http(s) thumbnail URLs)

## Configuration
- The CLI reads `SPECS/config.json` (fallback: `SPECS/config.example.json`).
- Thumbnail URL rewriting is controlled by:
```json
{
  "cdn": {
    "baseUrl": "https://irmarustad.github.io/Divi_templates",
    "rewriteThumbPaths": true
  }
}
```
- Update `baseUrl` if you use a different branch or hosting.

## CI / Remote Agent
Recommended steps:
```sh
npm ci
npm run setup
npm run discover
npm run thumbs
npm run publish
npm run validate
```
All commands exit non‑zero on failure to surface issues in CI.

