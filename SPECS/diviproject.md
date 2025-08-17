# Divi Live-Demo Catalog — Engineering Spec (v1)

> **Purpose**
> Build a **fully automated** pipeline that discovers all Elegant Themes (Divi) **live demo** pages, normalizes them into a versioned **`manifest.json`**, **enriches** each entry with design facets (light/dark, colorfulness, font pair, density/complexity, contrast hint), **renders thumbnails**, and publishes the manifest (and images) for consumption by a client-facing template picker.

---

## 1) Objectives & Non-Goals

### Objectives

* **Discovery**: Programmatically gather Divi **live demo URLs** and related layout metadata from Elegant Themes’ public pages.
* **Normalization**: Group pages into **packs** with stable IDs and predictable fields.
* **Enrichment**: Derive style facets automatically (fonts, background style, colorfulness, visual density, complexity, WCAG contrast hint).
* **Thumbnails**: Generate consistent, optimized preview images for each demo page.
* **Publishing**: Emit a versioned **`dist/manifest.json`** and thumbnails ready for CDN.
* **Idempotency**: Re-running the pipeline should only add new data or update changed entries; no duplicates.

### Non-Goals (v1)

* Importing layouts into WordPress or any Divi licensing flow.
* Self-hosting demo pages or iframing external demos.
* Any manual curation.

---

## 2) High-Level Architecture

```
Repo
├─ SPECS/                 # standards & references (this file lives here)
├─ scripts/               # CLI tools (crawler, enricher, thumbnailer, publisher)
├─ data/
│  ├─ raw/                # fetched & parsed sources (intermediate)
│  └─ work/               # merged, de-duped, normalized records
└─ dist/
   ├─ manifest.json       # final artifact (schema v1.2)
   └─ thumbs/             # generated WebP/AVIF thumbnails
```

**Pipeline stages**

1. **Discover** sources → `data/raw/*`
2. **Normalize & de-dupe** → `data/work/discovered.json`
3. **Enrich** (fonts/colors/density/complexity/contrast) → update in place
4. **Render thumbnails** → `dist/thumbs/*` and embed URLs back into records
5. **Publish** → `dist/manifest.json` with headers (`schema`, `generated_at`)

All stages are CLI-driven and safe to re-run.

---

## 3) Data Sources & URL Patterns

Use Elegant Themes’ public pages:

* **Layout Pack blog posts** (Divi Resources): each pack article includes a **“Live Demos”** list with direct links to every page demo in the pack.
* **Layout pages** under `/layouts/<category>/<layout-slug>`: each has a **“View Live Demo”** link (fallback); appending `/live-demo` often resolves to the same target.
* **Live demo pages**: some include a page switcher revealing sibling pages within the pack (cross-check, fill gaps).

### Discovery Rules (robust)

* Crawl the **blog category** feed for “Layout Pack” articles.
* Parse each article to locate a heading similar to **“Live Demos”** (case/whitespace tolerant); collect all anchors beneath it.
* For each **layout page** (backup seed), capture the “View Live Demo” URL; if absent, try `layoutUrl + '/live-demo'`.
* For each **live demo**, optionally parse top navigation to discover sibling demo pages.
* Normalize **relative/absolute** URLs to absolute.

### Politeness

* Custom `User-Agent` including project name & contact.
* Respect `robots.txt`.
* Rate limit 2–4 req/s with jitter; exponential backoff on 429/5xx.
* Cache responses with **ETag/Last-Modified** to avoid re-fetching unchanged pages.

---

## 4) Normalization

Create **pack** objects grouping **pages**:

* `pack_id`: slugified from pack title (lowercase, hyphenated; stable).
* `pack_name`: human title (e.g., “Restaurant”).
* `category`: first path segment after `/layouts/` (e.g., `business`, `art-design`).
* `source_post`: canonical pack article URL (if available).
* `pages[]`: array of **page** objects:

  * `page_name` (e.g., Home, About, Contact, Team, Portfolio, Services)
  * `layout_slug` (last segment of layout page URL, stable identifier)
  * `demo_url` (live demo URL)
  * `layout_url` (non-demo layout URL)
  * `thumbnail` (filled later)

**De-duplication key**: `(category, layout_slug)` ensures unique pages.
**Grouping**: tie pages to a pack via `source_post` or by inferred grouping rules from the blog post title; fall back to deriving a pack from sibling linkage on live demos if needed.

---

## 5) Enrichment (deterministic, offline)

Run against each `demo_url`:

### Fonts

* Parse HTML for Google Fonts `<link>` tags.
* Resolve primary families; map to:

  * `font_pair.heading`
  * `font_pair.body`
* Derive `font_mood` (one of: `modern`, `classic`, `playful`, `technical`) via a simple lookup table (e.g., Inter = modern; Playfair = classic; Comic-like = playful; Roboto Mono = technical).

### Background Style & Colorfulness

* Headless screenshot (viewport 1366×900) of the **hero** (above the fold).
* Compute:

  * **Average luminance** → `background_style` = `light` if > \~0.6, `dark` if < \~0.4; otherwise `colorful` if saturated colors dominate.
  * **Colorfulness** from saturation & palette variance → `low` | `medium` | `high`.

### Visual Density & Complexity (heuristics)

* Count visible **section** containers and **modules** within the first \~1.5 viewports.
* Measure word count in visible text nodes.
* Map to:

  * `visual_density`: `airy` | `balanced` | `dense`
  * `complexity`: integer 1..5

### WCAG Contrast Hint

* Estimate foreground text color in hero vs. dominant background using WCAG 2.x contrast formula (or APCA approximation).
* `wcag_contrast`: `pass` | `warn` (hint only; not a certification).

> All enrichment values are **stored** into the manifest so the picker does not re-compute them.


### Thresholds (reference)

- Luminance: light if avgL > 0.60; dark if avgL < 0.40; else evaluate colorfulness.
- Colorfulness index C in [0..1]: low if C ≤ 0.25; high if C ≥ 0.50; else medium.
- Visual density: count modules/sections within ~1.5 viewports. airy if ≤ 6 modules, balanced if 7–13, dense if ≥ 14.
- Complexity: map modules + unique components to 1..5 using quantiles; default 3.
- WCAG pass: contrast ratio ≥ 4.5 for normal text; else warn.

---

## 6) Thumbnails

* Use headless browser (e.g., Playwright/Chromium) to capture **hero** screenshots for each `demo_url`.
* Crop to a consistent aspect (e.g., 16:9), downscale to \~1200×675.
* Optimize to **WebP** (and/or AVIF) targeting \~60–120 KB.
* Save to `dist/thumbs/<category>/<layout_slug>.webp`.
* Write absolute URLs into `pages[].thumbnail`.

**Re-rendering policy**: only re-render thumbnails if the source page changed (based on ETag/Last-Modified or a content hash).

---

## 6a) Hero Detection Rules

- Primary: first full-bleed section above the fold with a height ≥ 60% of viewport and containing a prominent heading (h1/h2) or hero class (e.g., `.et_pb_section`, `.et_pb_fullwidth_header`).
- Fallback 1: first section whose bounding rect intersects y∈[0, 700] and contains an image or background image with width ≥ 60% viewport.
- Fallback 2: the topmost section (document body) clipped to the initial viewport.
- If no section matches, classify background_style via the top 600px screenshot.



---

## 7) Manifest Schema (v1.2)

**Top-level**

```json
{
  "schema": "1.2",
  "generated_at": "2025-08-17T00:00:00Z",
  "source": {
    "crawl_version": "2025.08.17",
    "seeds": ["blog-packs", "layout-pages"]
  },
  "items": [ /* Pack objects */ ]
}
```

**Pack object**

```json
{
  "pack_id": "restaurant",
  "pack_name": "Restaurant",
  "category": "business",
  "source_post": "https://…/blog/divi-resources/...-layout-pack-for-divi",
  "pages": [
    {
      "page_name": "Team",
      "layout_slug": "restaurant-team-page",
      "demo_url": "https://www.elegantthemes.com/layouts/business/restaurant-team-page/live-demo",
      "layout_url": "https://www.elegantthemes.com/layouts/business/restaurant-team-page",
      "thumbnail": "https://cdn.example.com/thumbs/business/restaurant-team-page.webp"
    }
  ],
  "facets": {
    "background_style": "light",             // enum: light | dark | colorful
    "colorfulness": "medium",                // enum: low | medium | high
    "font_pair": { "heading": "Playfair Display", "body": "Inter" },
    "font_mood": "modern",                   // enum: modern | classic | playful | technical
    "visual_density": "airy",                // enum: airy | balanced | dense
    "complexity": 2,                         // int 1..5
    "wcag_contrast": "pass"                  // enum: pass | warn
  },
  "approved": true,
  "version": "1.0.0",
  "notes": ""
}
```

**Required fields**

* Top: `schema`, `generated_at`, `items[]`.
* Pack: `pack_id`, `pack_name`, `category`, `pages[]`.
* Page: `layout_slug`, `demo_url`.

**Deterministic IDs**

* `pack_id` = slugified `pack_name` (lowercase, hyphens).
* `layout_slug` = last path segment of layout page URL.

---

## 8) CLI Surface (developer UX)

Provide a single entry CLI (e.g., `node ./scripts/index.mjs <command> [options]`):

* `discover`
  Fetch blog pack posts + layout pages; parse; write:

  * `data/raw/pack_posts.json`
  * `data/raw/layout_pages.json`
  * `data/work/discovered.json` (merged, de-duped)

* `enrich`
  For each page in `data/work/discovered.json`, add `facets.*` values. Supports `--only-changed`.

* `thumbs`
  Render WebP thumbnails to `dist/thumbs/*` and update `pages[].thumbnail`.

* `publish`
  Validate against schema, write `dist/manifest.json` (adds `schema`, `generated_at`).

* `validate`
  Validate `dist/manifest.json` against `SPECS/manifest.schema.json`.

* `check-links`
  HEAD/GET each `pages[].demo_url` with rate limit; report non-200; optionally mark as `approved: false`.

**Common flags**

* `--concurrency`, `--delay-ms`, `--timeout-ms`, `--ua`, `--since <ISO date>`
* `--log=json|pretty`, `--dry-run`
* `--only-pack <id>`, `--only-category <slug>`

---

## 9) Configuration

`SPECS/config.example.json`


### Change Detection & Versioning

- Change detection: prefer HTTP cache headers (ETag/Last-Modified). If unavailable, compute a stable hash of the hero DOM (text + styles + image URLs) and compare with prior.
- Thumbnails: re-render only when change detected or missing.
- Pack versioning: use semver; bump patch on enrichment tweaks or link changes, minor on added/removed pages, major on schema changes or structural renames. Include `generated_at` at top-level for run auditability.

### Link Health Policy

- On `check-links`, attempt up to `linkHealth.retryCount` with exponential backoff (`retryBackoffMs`) per URL.
- Mark `approved: false` only after `demoteAfterConsecutiveFailures` within `demotionWindowHours`.
- Always preserve existing records and carry a `notes` string with the last failure summary.

### Observability

- Emit JSON logs with per-URL context: phase, URL, status, duration, cacheHit, retries.
- At end of each phase, print a summary: fetched, cache hits, discovered, updated, thumbs rendered, failures by type.

```json
{
  "userAgent": "DiviCatalogBot/1.0 (+contact@email)",
  "rateLimit": { "rps": 3, "jitterMs": 150 },
  "timeouts": { "requestMs": 15000, "navMs": 20000 },
  "viewports": { "w": 1366, "h": 900 },
  "cache": { "dir": ".cache/http", "respectEtags": true },
  "thumbs": { "format": "webp", "maxW": 1200, "maxH": 675, "quality": 82 },
  "paths": {
    "raw": "data/raw",
    "work": "data/work",
    "dist": "dist"
  }
}
```

The CLI reads `SPECS/config.json` (repo-local override) falling back to the example.

---

## 10) Error Handling & Idempotency

* **HTTP**: retry with exponential backoff; on repeated failure, keep prior record unchanged and flag `notes`.
* **Parser drift**: if a selector yields nothing, record a structured warning for that source URL; do not drop existing entries.
* **Duplicates**: dedupe by `(category, layout_slug)`; a second occurrence updates fields only if different.
* **Partial runs**: every stage writes **atomic** temp files and renames on success to avoid corrupting outputs.
* **Resumability**: `--since` and `--only-*` flags allow targeted re-runs.

---

## 11) Validation & Testing

### Validation

* JSON Schema at `SPECS/manifest.schema.json` (matches section 7).
* `npm run validate` must pass before `publish`.

### Unit & Integration Tests

* **Unit**: parsing helpers (heading detection, anchor extraction, slugification).
* **Integration**: recorded fixtures (HTML snapshots) for pack posts, layout pages, and live demos; snapshot tests for normalized output.

Thumbnail storage policy:

- Default path: `dist/thumbs/<category>/<layout_slug>.webp`.
- If `SPECS/config.json` or `SPECS/config.example.json` sets `cdn.baseUrl` and `cdn.rewriteThumbPaths=true`, publish absolute URLs as `${baseUrl}/thumbs/<category>/<layout_slug>.webp` while still storing files under `dist/thumbs` for local dev/CI.
- Keep thumbnails in-repo to simplify CI and reviews; optionally mirror to CDN in deployment.


* **E2E (optional)**: mock a small crawl against a few known URLs; assert `manifest.json` structure and a thumbnail presence.

---

## 12) CI (GitHub Actions) – Suggested

Workflow `/.github/workflows/build-manifest.yml`:

* Triggers: manual & scheduled (e.g., weekly).
* Steps:

  1. Install deps, warm cache.
  2. `npm run discover`
  3. `npm run enrich`
  4. `npm run thumbs`
  5. `npm run publish`
  6. `npm run validate`
  7. Commit changes on a branch and **open a Pull Request** (`peter-evans/create-pull-request`).

No secrets required (public web only). Thumbnails kept in repo or pushed to a storage bucket if preferred (then write absolute URLs).

---

## 13) Performance & Limits

* Expected scale: O(2–3k) demo pages.
* Full run target: ≤ 60 minutes on default concurrency and cache warm.
* Disk: thumbnails \~200–400 MB (WebP). Keep under control by pruning old or unchanged shots.

---

## 14) Security & Compliance

* Respect `robots.txt`.
* Identify with a clear `User-Agent`.
* Store only:

  * URLs and minimal textual labels
  * Thumbnails/screenshots you generated
* Do **not** hotlink images from Elegant Themes; serve your thumbnails.
* Do **not** embed or scrape authenticated content.

---

## 15) Acceptance Criteria (v1)

* `dist/manifest.json` exists, validates against schema, and includes:

  * Coverage ≥ 90% of currently discoverable demo pages across packs.
  * Enrichment fields present for ≥ 95% of pages.
  * Thumbnails for ≥ 95% of pages, loading within 300 ms locally.
* Link checker reports ≥ 95% HTTP 200 on `demo_url`.
* Re-running the pipeline does not produce duplicates and only diffs changed/new items.

---

## 16) Roadmap (post-v1)

* Add **link-health** scheduled job; auto-demote broken entries.
* Add **industry tagging** via keyword rules (page content heuristics).
* Add **analytics** fields (preview count, selection count) as external signals.
* Optional: emit a **compact manifest** for mobile UIs.

---

## 17) Glossary

* **Pack**: a themed set of page layouts (Home, About, Contact, etc.).
* **Layout page**: an info page describing a single layout; links to its live demo.
* **Live demo**: rendered preview page hosted by Elegant Themes.
* **Facets**: derived style attributes used for filtering in the client UI.

---

### Developer Notes

* Preferred stack: **Node.js 20+**, **Playwright** for navigation/screenshots, `got` (or `undici`) for HTTP with ETag cache, `cheerio` for HTML parsing, `ajv` for JSON schema validation, `p-limit` for concurrency control, `sharp` for image post-processing.
* Keep **pure functions** for parsing/normalization; integration points (HTTP, FS, Playwright) are thin wrappers to ease testing.
* Emit **structured logs** (JSON) with per-URL context for traceability.
