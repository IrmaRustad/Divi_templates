# Runbooks

## Discover
- Run: `npm run discover`
- Writes: `data/work/discovered.json`

## Thumbnails
- Run: `npm run thumbs`
- Writes: `dist/thumbs/<category>/<layout_slug>.webp`
- Side-effect: updates `page.thumbnail` in discovered.json to `thumbs/...` (relative)

## Enrich
- Run: `npm run enrich`
- Updates: `facets` in `data/work/discovered.json`

## Publish
- Run: `npm run publish`
- Reads: `data/work/discovered.json`
- Writes: `dist/manifest.json`
- Requires: All `page.thumbnail` to be http(s). If they are relative, set `SPECS/config.json` cdn.baseUrl and cdn.rewriteThumbPaths=true.

## Validate
- Run: `npm run validate`
- Validates: `dist/manifest.json` against `SPECS/manifest.schema.json`

