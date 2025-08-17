#!/usr/bin/env node
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { performance } from 'node:perf_hooks';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetch } from 'undici';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = process.cwd();
const specsDir = path.join(root, 'SPECS');
const dataDir = path.join(root, 'data');
const distDir = path.join(root, 'dist');

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

async function cmdDiscover(){
  await ensureDirs();
  // Minimal seed using provided example live demo
  const demo = 'https://www.elegantthemes.com/layouts/art-design/design-agency-contact-page/live-demo';
  const info = deriveFromDemoUrl(demo);
  const item = {
    pack_id: info.packId,
    pack_name: info.packName,
    category: info.category,
    source_post: '',
    pages: [
      {
        page_name: info.pageName,
        layout_slug: info.layoutSlug,
        demo_url: demo,
        layout_url: info.layoutUrl,
        thumbnail: ''
      }
    ],
    facets: {},
    approved: true,
    version: '1.0.0',
    notes: ''
  };
  const discovered = { items: [item] };
  await fs.writeJson(path.join(dataDir, 'work', 'discovered.json'), discovered, { spaces: 2 });
  console.log('discover: wrote data/work/discovered.json (1 item)');
}

async function cmdThumbs(){
  const cfg = await loadConfig();
  const discoveredPath = path.join(dataDir, 'work', 'discovered.json');
  const data = await fs.readJson(discoveredPath);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    for (const pack of data.items){
      for (const page of pack.pages){
        const ctx = await browser.newContext({ viewport: { width: cfg.viewports.w, height: cfg.viewports.h } });
        const p = await ctx.newPage();
        await p.goto(page.demo_url, { waitUntil: 'domcontentloaded', timeout: cfg.timeouts.navMs });
        // allow a short settle
        await p.waitForTimeout(1500);
        const buf = await p.screenshot({ fullPage: false });
        await ctx.close();
        // process with sharp to target 1200x675 webp
        const sharp = (await import('sharp')).default;
        const outDir = path.join(distDir, 'thumbs', pack.category);
        await fs.ensureDir(outDir);
        const outPath = path.join(outDir, `${page.layout_slug}.webp`);
        const img = sharp(buf).resize({ width: cfg.thumbs.maxW, height: cfg.thumbs.maxH, fit: 'cover' }).webp({ quality: cfg.thumbs.quality });
        await img.toFile(outPath);
        // Store relative repo path in discovered.json
        page.thumbnail = `thumbs/${pack.category}/${page.layout_slug}.webp`;
        if (!pack.source_post) pack.source_post = 'https://www.elegantthemes.com/layouts/';
        console.log(`thumbs: wrote ${outPath}`);
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
  const manifest = {
    schema: '1.2',
    generated_at: new Date().toISOString(),
    source: { crawl_version: new Date().toISOString().slice(0,10).replace(/-/g,'.'), seeds: ['blog-packs','layout-pages'] },
    items: base.items || []
  };
  // Rewrite relative thumbs to absolute http(s)
  for (const pack of manifest.items){
    for (const page of pack.pages){
      if (page.thumbnail && !/^https?:\/\//i.test(page.thumbnail)){
        const base = cfg.cdn?.baseUrl?.replace(/\/$/,'');
        if (cfg.cdn?.rewriteThumbPaths && base){
          page.thumbnail = `${base}/${page.thumbnail}`;
        } else {
          throw new Error(`publish: thumbnail for ${pack.pack_id}/${page.layout_slug} is not http(s). Set cdn.baseUrl and cdn.rewriteThumbPaths=true.`);
        }
      }
    }
  }
  const tmp = path.join(distDir, 'manifest.tmp.json');
  await fs.writeJson(tmp, manifest, { spaces: 2 });
  await fs.move(tmp, path.join(distDir, 'manifest.json'), { overwrite: true });
  console.log('publish: wrote dist/manifest.json');
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

