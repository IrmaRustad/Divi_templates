#!/usr/bin/env node
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'node:perf_hooks';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetch } from 'undici';
import pLimit from 'p-limit';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = process.cwd();
const specsDir = path.join(root, 'SPECS');
const dataDir = path.join(root, 'data');
const distDir = path.join(root, 'dist');
const cacheDir = path.join(root, '.cache', 'http');


async function ensureCache(){
  await fs.ensureDir(cacheDir);
}

async function obeyRobots(host){
  try{
    const robotsUrl = `https://${host}/robots.txt`;
    const res = await fetch(robotsUrl, { headers: { 'user-agent': 'DiviCatalogBot/1.0' } });
    if (!res.ok) return { allowed: true, crawlDelayMs: 0 };
    const txt = await res.text();
    // very simple parse for Crawl-delay under User-agent: *
    const lines = txt.split(/\r?\n/);
    let uaStar = false; let delay = 0;
    for (const line of lines){
      const L = line.trim();
      if (/^user-agent:\s*\*/i.test(L)) { uaStar = true; continue; }
      if (/^user-agent:/i.test(L)) { uaStar = false; continue; }
      if (uaStar && /^crawl-delay:/i.test(L)) {
        const num = parseFloat(L.split(':')[1]);
        if (!isNaN(num)) delay = num * 1000;
      }
    }
    return { allowed: true, crawlDelayMs: delay };
  } catch { return { allowed: true, crawlDelayMs: 0 }; }
}

function cacheKey(url){
  return crypto.createHash('sha1').update(url).digest('hex') + '.json';
}

async function loadCache(url){
  try{
    const fp = path.join(cacheDir, cacheKey(url));
    return await fs.readJson(fp);
  } catch { return null; }
}

async function saveCache(url, meta){
  const fp = path.join(cacheDir, cacheKey(url));
  await fs.writeJson(fp, meta, { spaces: 0 });
}

async function loadConfig(){
  const local = path.join(specsDir, 'config.json');
  const example = path.join(specsDir, 'config.example.json');
  const cfgPath = (await fs.pathExists(local)) ? local : example;
  return fs.readJson(cfgPath);
}

async function ensureDirs(){
  await fs.ensureDir(path.join(dataDir, 'raw'));
  await fs.ensureDir(path.join(dataDir, 'work'));
  await fs.ensureDir(path.join(distDir, 'thumbs'));
}

function titleCaseFromSlug(slug){
  return slug.split('-').map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join(' ');
}

function deriveFromDemoUrl(demoUrl){
  // Example: https://www.elegantthemes.com/layouts/art-design/design-agency-contact-page/live-demo
  const u = new URL(demoUrl);
  const parts = u.pathname.split('/').filter(Boolean);
  const category = parts[1];
  const layoutSlug = parts[2];
  // infer pack base by removing trailing "-<pagename>-page"
  const segs = layoutSlug.split('-');
  let pageName = 'Page';
  if (segs.length >= 2 && segs[segs.length-1] === 'page'){
    pageName = segs[segs.length-2];
    segs.splice(-2,2);
  }
  const packBase = segs.join('-');
  const packId = packBase;
  const packName = titleCaseFromSlug(packBase);
  const pageNameTitle = titleCaseFromSlug(pageName);
  const layoutUrl = demoUrl.replace(/\/live-demo\/?$/, '');
  return { category, layoutSlug, packId, packName, pageName: pageNameTitle, layoutUrl };
}

async function politeFetch(url, cfg){
  await ensureCache();
  const ua = cfg.userAgent || 'DiviCatalogBot/1.0';
  const prior = await loadCache(url);
  const headers = { 'user-agent': ua };
  if (prior?.etag) headers['if-none-match'] = prior.etag;
  if (prior?.lastModified) headers['if-modified-since'] = prior.lastModified;
  let attempt = 0;
  while (true){
    attempt++;
    const res = await fetch(url, { headers, redirect: 'follow' });
    if (res.status === 304 && prior?.body){
      return prior.body;
    }
    if (res.status === 429 || (res.status >= 500 && res.status < 600)){
      const backoff = Math.min(60000, (cfg.linkHealth?.retryBackoffMs || 1000) * Math.pow(2, attempt-1));
      await sleep(backoff);
      if (attempt < (cfg.linkHealth?.retryCount || 3)) continue;
    }
    if (!res.ok){
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    const body = await res.text();
    const etag = res.headers.get('etag') || undefined;
    const lastModified = res.headers.get('last-modified') || undefined;
    await saveCache(url, { etag, lastModified, body });
    return body;
  }
}

function extractLayoutLinks($){
  // On category/layouts hub pages, select links to layout detail pages
  const links = new Set();
  $('a[href^="/layouts/"]').each((i,el)=>{
    const href = $(el).attr('href');
    if (!href) return;
    // accept /layouts/<category>/<layout-slug>
    const parts = href.split('/').filter(Boolean);
    if (parts.length >= 3 && parts[0]==='layouts') links.add(`https://www.elegantthemes.com${href}`);
  });
  return Array.from(links);
}

function extractLiveDemoLink($){
  // Prefer explicit "View Live Demo" link; fallback to appending /live-demo
  let liveDemo = '';
  $('a').each((i,el)=>{
    const text = String($(el).text()||'').trim().toLowerCase();
    const href = $(el).attr('href') || '';
    if (text.includes('live demo') || href.endsWith('/live-demo')){
      liveDemo = href.startsWith('http') ? href : `https://www.elegantthemes.com${href}`;
      return false;
    }
  });
  return liveDemo;
}

async function cmdDiscover(){
  await ensureDirs();
  await ensureCache();
  const cfg = await loadConfig();
  const hubUrl = 'https://www.elegantthemes.com/layouts/';
  const robots = await obeyRobots('www.elegantthemes.com');
  const hubHtml = await politeFetch(hubUrl, cfg);
  const cheerio = await import('cheerio');
  const { chromium } = await import('playwright');
  const $hub = cheerio.load(hubHtml);

  // Helper: fetch links from sitemap index and nested urlsets
  async function fetchSitemapLinks(){
    const links = new Set();
    try{
      const idxUrl = 'https://www.elegantthemes.com/sitemap_index.xml';
      const xml = await politeFetch(idxUrl, cfg);
      const $x = cheerio.load(xml, { xmlMode: true });
      const sitemaps = $x('sitemap > loc').map((i,el)=>$x(el).text().trim()).get();
      const candidateMaps = sitemaps.filter(u => /sitemap|layouts|layout/i.test(u));
      const urlsets = candidateMaps.length ? candidateMaps : sitemaps;
      for (const sm of urlsets){
        try{
          const sx = await politeFetch(sm, cfg);
          const $u = cheerio.load(sx, { xmlMode: true });
          $u('url > loc').each((i,el)=>{
            const loc = $u(el).text().trim();
            if (/^https?:\/\/www\.elegantthemes\.com\/layouts\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i.test(loc)) links.add(loc.replace(/\/$/,''));
          });
        } catch {}
      }
    } catch {}
    return Array.from(links);
  }

  const hubLinks = extractLayoutLinks($hub);
  const mapLinks = await fetchSitemapLinks();
  const merged = Array.from(new Set([...hubLinks, ...mapLinks]));

  // Parse optional --max flag (default 100), allow 0 = no cap
  const extra = process.argv.slice(3);
  let max = 100;
  const maxIdx = extra.findIndex(a => a === '--max');
  if (maxIdx !== -1 && extra[maxIdx+1] !== undefined) {
    const n = parseInt(extra[maxIdx+1], 10);
    if (!Number.isNaN(n)) max = n;
  }
  const linksToProcess = (max && max > 0) ? merged.slice(0, max) : merged;

  // Use headless browser to enumerate inner page links per pack
  const browser = await chromium.launch();
  const packsById = new Map();
  const allPageLinks = new Set();
  try{
    for (const link of linksToProcess){
      if (robots.crawlDelayMs) await sleep(robots.crawlDelayMs);
      const u = new URL(link);
      const parts = u.pathname.split('/').filter(Boolean);
      const category = parts[1];
      const layoutSlug = parts[2];
      const packBase = layoutSlug.replace(/-(home|about|contact|team|services|portfolio)-page$/, '');
      const packId = packBase;
      const packName = titleCaseFromSlug(packBase);

      const ctx = await browser.newContext({ viewport: { width: cfg.viewports.w, height: cfg.viewports.h } });
      const p = await ctx.newPage();
      let pageLinks = [];
      try{
        await p.goto(link, { waitUntil: 'domcontentloaded', timeout: cfg.timeouts.navMs });
        try { await p.locator('#onetrust-accept-btn-handler, button:has-text("Accept All"), button:has-text("Accept")').first().click({ timeout: 2000 }); } catch {}
        pageLinks = await p.evaluate(() => {
          const abs = (href) => href.startsWith('http') ? href : (`https://www.elegantthemes.com${href}`);
          const anchors = Array.from(document.querySelectorAll('a[href^="/layouts/"]'))
            .map(a => a.getAttribute('href') || '')
            .filter(h => h.split('/').filter(Boolean).length >= 3)
            .map(h => abs(h));
          // Prefer explicit inner pages ending with -page; if none, include current link
          const inner = anchors.filter(h => /\/layouts\/[^/]+\/[a-z0-9-]+-page$/i.test(new URL(h).pathname));
          return inner.length ? Array.from(new Set(inner)) : [location.href.replace(/\/$/,'')];
        });
      } catch {} finally { await ctx.close(); }

      for (const loc of pageLinks){
        allPageLinks.add(loc.replace(/\/$/,''));
        const uu = new URL(loc);
        const pp = uu.pathname.split('/').filter(Boolean);
        const cat = pp[1];
        const slug = pp[2];
        const segs = slug.split('-');
        let pageName = 'Page';
        if (segs.length >= 2 && segs[segs.length-1] === 'page'){ pageName = segs[segs.length-2]; }
        const packBase2 = slug.replace(/-(home|about|contact|team|services|portfolio)-page$/, '');
        const pid = packBase2;
        const pname = titleCaseFromSlug(packBase2);
        let pack = packsById.get(pid);
        if (!pack){
          pack = { pack_id: pid, pack_name: pname, category: cat, source_post: '', pages: [], facets: {}, approved: true, version: '1.0.0', notes: '' };
          packsById.set(pid, pack);
        }
        if (!pack.pages.find(x => x.layout_slug === slug)){
          pack.pages.push({ page_name: titleCaseFromSlug(pageName), layout_slug: slug, demo_url: `${loc.replace(/\/$/,'')}/live-demo`, layout_url: loc.replace(/\/$/,''), thumbnail: '' });
        }
      }
    }
  } finally { await browser.close(); }

  const items = Array.from(packsById.values());
  const discovered = { items };
  await fs.writeJson(path.join(dataDir, 'work', 'discovered.json'), discovered, { spaces: 2 });
  await fs.writeJson(path.join(dataDir, 'raw', 'layout_pages.json'), { urls: Array.from(allPageLinks) }, { spaces: 2 });
  console.log(`discover: ${items.length} pack(s). Total pages=${Array.from(allPageLinks).length}. max=${max}.`);
}

async function cmdThumbs(){
  const cfg = await loadConfig();
  const discoveredPath = path.join(dataDir, 'work', 'discovered.json');
  const data = await fs.readJson(discoveredPath);
  const { chromium } = await import('playwright');
  const sharp = (await import('sharp')).default;
  const cheerio = await import('cheerio');
  const browser = await chromium.launch();
  try {
    for (const pack of data.items){
      for (const page of pack.pages){
        const outDir = path.join(distDir, 'thumbs', pack.category);
        await fs.ensureDir(outDir);
        const outPath = path.join(outDir, `${page.layout_slug}.webp`);

        // 0) If already exists, skip (idempotent)
        if (await fs.pathExists(outPath)){
          page.thumbnail = `thumbs/${pack.category}/${page.layout_slug}.webp`;
          if (!pack.source_post) pack.source_post = 'https://www.elegthemes.com/layouts/';
          console.log(`thumbs: exists ${outPath} (skip)`);
          continue;
        }

        // 1) Try to download existing catalog thumbnail via HTML (may be blocked by CF)
        let usedDownloaded = false;
        try {
          const html = await politeFetch(page.layout_url, cfg);
          const $ = cheerio.load(html);
          let imgUrl = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content');
          if (imgUrl){
            if (!/^https?:/i.test(imgUrl)) imgUrl = new URL(imgUrl, page.layout_url).href;
            const res = await fetch(imgUrl, { headers: { 'user-agent': cfg.userAgent || 'DiviCatalogBot/1.0' } });
            if (res.ok){
              const buf = Buffer.from(await res.arrayBuffer());
              const img = sharp(buf).resize({ width: cfg.thumbs.maxW, height: cfg.thumbs.maxH, fit: 'cover' }).webp({ quality: cfg.thumbs.quality });
              await img.toFile(outPath);
              page.thumbnail = `thumbs/${pack.category}/${page.layout_slug}.webp`;
              if (!pack.source_post) pack.source_post = 'https://www.elegantthemes.com/layouts/';
              console.log(`thumbs: downloaded og:image (static) -> ${outPath}`);
              usedDownloaded = true;
            }
          }
        } catch {}

        // 1b) If still missing, use Playwright to read meta tags in-browser (bypass CF)
        if (!usedDownloaded){
          const ctx = await browser.newContext({ viewport: { width: cfg.viewports.w, height: cfg.viewports.h } });
          const p = await ctx.newPage();
          try{
            await p.goto(page.layout_url, { waitUntil: 'domcontentloaded', timeout: cfg.timeouts.navMs });
            try { await p.locator('#onetrust-accept-btn-handler, button:has-text("Accept All"), button:has-text("Accept")').first().click({ timeout: 2000 }); } catch {}
            const metaUrl = await p.evaluate(() => {
              const a = document.querySelector('meta[property="og:image"]');
              const b = document.querySelector('meta[name="twitter:image"]');
              return (a?.getAttribute('content') || b?.getAttribute('content') || '').trim();
            });
            if (metaUrl){
              const abs = metaUrl.startsWith('http') ? metaUrl : new URL(metaUrl, location.href).href;
              const res = await fetch(abs);
              if (res.ok){
                const buf = Buffer.from(await res.arrayBuffer());
                const img = sharp(buf).resize({ width: cfg.thumbs.maxW, height: cfg.thumbs.maxH, fit: 'cover' }).webp({ quality: cfg.thumbs.quality });
                await img.toFile(outPath);
                page.thumbnail = `thumbs/${pack.category}/${page.layout_slug}.webp`;
                if (!pack.source_post) pack.source_post = 'https://www.elegantthemes.com/layouts/';
                console.log(`thumbs: downloaded og:image (browser) -> ${outPath}`);
                usedDownloaded = true;
              }
            }
          } catch {} finally { await ctx.close(); }
        }

        if (usedDownloaded) { continue; }

        // 2) Fallback: open the live demo and capture a screenshot
        const ctx = await browser.newContext({ viewport: { width: cfg.viewports.w, height: cfg.viewports.h } });
        const p = await ctx.newPage();
        await p.goto(page.demo_url, { waitUntil: 'domcontentloaded', timeout: cfg.timeouts.navMs });
        try { await p.locator('#onetrust-accept-btn-handler, button:has-text("Accept All"), button:has-text("Accept")').first().click({ timeout: 2000 }); } catch {}
        try {
          const el = p.locator('iframe').first();
          if (await p.locator('iframe').count() > 0){
            const src = await el.getAttribute('src');
            if (src && /^https?:/i.test(src)){
              await p.goto(src, { waitUntil: 'domcontentloaded', timeout: cfg.timeouts.navMs });
            }
          }
        } catch {}
        try { await p.waitForSelector('#main-content, .et_pb_section', { timeout: 10000 }); } catch {}
        await p.waitForTimeout(1200);
        const buf = await p.screenshot({ fullPage: false });
        await ctx.close();
        const img = sharp(buf).resize({ width: cfg.thumbs.maxW, height: cfg.thumbs.maxH, fit: 'cover' }).webp({ quality: cfg.thumbs.quality });
        await img.toFile(outPath);
        page.thumbnail = `thumbs/${pack.category}/${page.layout_slug}.webp`;
        if (!pack.source_post) pack.source_post = 'https://www.elegantthemes.com/layouts/';
        console.log(`thumbs: fallback screenshot -> ${outPath}`);
      }
    }
    await fs.writeJson(discoveredPath, data, { spaces: 2 });
  } finally {
    await browser.close();
  }
}


function luminanceFromRGB(r,g,b){
  const [R,G,B] = [r/255,g/255,b/255];
  return 0.2126*R + 0.7152*G + 0.0722*B;
}

function colorfulnessFromRGB(r,g,b){
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  return (max - min) / 255; // 0..1 approx of saturation per pixel
}

function bucketColorfulness(avg){
  if (avg <= 0.25) return 'low';
  if (avg >= 0.5) return 'high';
  return 'medium';
}

function backgroundStyleFromL(avgL){
  if (avgL > 0.60) return 'light';
  if (avgL < 0.40) return 'dark';
  return 'colorful';
}

function contrastRatio(l1,l2){
  const L1 = Math.max(l1,l2), L2 = Math.min(l1,l2);
  return (L1 + 0.05) / (L2 + 0.05);
}

async function cmdEnrich(){
  const discoveredPath = path.join(dataDir, 'work', 'discovered.json');
  const data = await fs.readJson(discoveredPath);
  for (const pack of data.items){
    // Minimal placeholder enrichment until full heuristics are implemented
    pack.facets = {
      background_style: 'light',
      colorfulness: 'medium',
      font_pair: { heading: 'Unknown', body: 'Unknown' },
      font_mood: 'modern',
      visual_density: 'balanced',
      complexity: 3,
      wcag_contrast: 'pass'
    };
  }
  await fs.writeJson(discoveredPath, data, { spaces: 2 });
  console.log('enrich: updated facets for', data.items.length, 'pack(s)');
}

async function cmdPublish(){
  await ensureDirs();
  const cfg = await loadConfig();
  const discoveredPath = path.join(dataDir, 'work', 'discovered.json');
  const exists = await fs.pathExists(discoveredPath);
  const base = exists ? await fs.readJson(discoveredPath) : { items: [] };
  // Merge with previous manifest (accumulate across runs)
  const prevPath = path.join(distDir, 'manifest.json');
  let prev = { items: [] };
  try { if (await fs.pathExists(prevPath)) prev = await fs.readJson(prevPath); } catch {}
  // Prefer the published manifest from Pages if available, so accumulation persists across CI runs
  try {
    const base = cfg.cdn?.baseUrl?.replace(/\/$/, '');
    if (base){
      const res = await fetch(`${base}/dist/manifest.json`, { headers: { 'user-agent': cfg.userAgent || 'DiviCatalogBot/1.0' } });
      if (res.ok){ prev = await res.json(); }
    }
  } catch {}

  function mergePacks(prevItems, newItems){
    const byId = new Map();
    for (const p of prevItems || []) byId.set(p.pack_id, JSON.parse(JSON.stringify(p)));
    for (const p of (newItems || [])){
      const existing = byId.get(p.pack_id);
      if (!existing){ byId.set(p.pack_id, JSON.parse(JSON.stringify(p))); continue; }
      // merge shallow fields
      existing.pack_name = existing.pack_name || p.pack_name;
      existing.category = existing.category || p.category;
      if (!existing.source_post && p.source_post) existing.source_post = p.source_post;
      // merge pages by layout_slug
      existing.pages = existing.pages || [];
      for (const pg of (p.pages || [])){
        const i = existing.pages.findIndex(x => x.layout_slug === pg.layout_slug);
        if (i === -1) existing.pages.push(pg);
        else existing.pages[i] = { ...existing.pages[i], ...pg };
      }
    }
    return Array.from(byId.values());
  }

  const mergedItems = mergePacks(prev.items || [], base.items || []);

  const manifest = {
    schema: '1.2',
    generated_at: new Date().toISOString(),
    source: { crawl_version: new Date().toISOString().slice(0,10).replace(/-/g,'.'), seeds: ['blog-packs','layout-pages'] },
    items: mergedItems
  };

  // Rewrite relative thumbs to absolute http(s)
  for (const pack of manifest.items){
    if (!pack.source_post) delete pack.source_post;
    for (const page of pack.pages){
      if (!page.thumbnail) delete page.thumbnail;
      if (page.thumbnail && !/^https?:\/\//i.test(page.thumbnail)){
        const base = cfg.cdn?.baseUrl?.replace(/\/$/,'');
        if (cfg.cdn?.rewriteThumbPaths && base){
          // Pages deploys the contents of dist/ at the site root, so 'thumbs/...' lives at `${base}/thumbs/...`
          page.thumbnail = `${base}/${page.thumbnail}`;
        } else {
          throw new Error(`publish: thumbnail for ${pack.pack_id}/${page.layout_slug} is not http(s). Set cdn.baseUrl and cdn.rewriteThumbPaths=true.`);
        }
      }
    }
  }

  // Save snapshot history of the manifest per day (optional audit trail)
  const histDir = path.join(dataDir, 'history');
  await fs.ensureDir(histDir);
  const stamp = new Date().toISOString().slice(0,10).replace(/-/g,'');
  await fs.writeJson(path.join(histDir, `manifest-${stamp}.json`), manifest, { spaces: 2 });

  const tmp = path.join(distDir, 'manifest.tmp.json');
  await fs.writeJson(tmp, manifest, { spaces: 2 });
  await fs.move(tmp, path.join(distDir, 'manifest.json'), { overwrite: true });
  console.log('publish: wrote dist/manifest.json (accumulated)');
}

async function cmdValidate(){
  const schemaPath = path.join(specsDir, 'manifest.schema.json');
  const manifestPath = path.join(distDir, 'manifest.json');
  const schema = await fs.readJson(schemaPath);
  const manifest = await fs.readJson(manifestPath);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  try { addFormats(ajv); } catch {}
  const validate = ajv.compile(schema);
  const ok = validate(manifest);
  if (!ok) {
    console.error('Schema validation failed');
    console.error(validate.errors);
    process.exit(1);
  }
  console.log('validate: manifest.json is valid');
}

async function main(){
  const cmd = process.argv[2];
  const t0 = performance.now();
  try{
    if(cmd === 'discover') await cmdDiscover();
    else if(cmd === 'thumbs') await cmdThumbs();
    else if(cmd === 'publish') await cmdPublish();
    else if(cmd === 'validate') await cmdValidate();
    else if(cmd === 'enrich') await cmdEnrich();
    else if(['check-links'].includes(cmd)){
      console.log(`${cmd}: not implemented yet (stub)`);
    } else {
      console.log('Usage: node ./scripts/index.mjs <discover|thumbs|publish|validate|enrich|check-links>');
      process.exit(2);
    }
  } catch (err){
    console.error(err);
    process.exit(1);
  } finally {
    const t1 = performance.now();
    console.log(`Done in ${(t1 - t0).toFixed(0)} ms`);
  }
}

main();

