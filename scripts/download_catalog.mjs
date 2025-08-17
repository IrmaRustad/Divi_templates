#!/usr/bin/env node
import fs from 'fs-extra';
import path from 'path';
import { fetch } from 'undici';

async function main(){
  const outRoot = process.argv[2] || 'catalog_local';
  const manifestUrl = process.argv[3] || 'https://irmarustad.github.io/Divi_templates/manifest.json';
  await fs.ensureDir(outRoot);
  console.log('Downloading manifest from', manifestUrl);
  const res = await fetch(manifestUrl, { headers: { 'user-agent': 'DiviCatalogDownloader/1.0' }});
  if (!res.ok){
    console.error('Failed to fetch manifest:', res.status, await res.text().catch(()=>''));
    process.exit(1);
  }
  const manifest = await res.json();
  const manifestPath = path.join(outRoot, 'manifest.json');
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  let imgCount = 0, failCount = 0;
  for (const pack of manifest.items || []){
    const catDir = path.join(outRoot, 'thumbs', pack.category || 'unknown');
    await fs.ensureDir(catDir);
    for (const page of pack.pages || []){
      const url = page.thumbnail;
      if (!url) continue;
      const outPath = path.join(catDir, `${page.layout_slug}.webp`);
      try{
        const r = await fetch(url, { headers: { 'user-agent': 'DiviCatalogDownloader/1.0' }});
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const ab = await r.arrayBuffer();
        await fs.writeFile(outPath, Buffer.from(ab));
        imgCount++;
        process.stdout.write('.');
      } catch (err){
        failCount++;
        console.warn(`\nfailed: ${url} -> ${err}`);
      }
    }
  }
  console.log(`\nSaved manifest to ${manifestPath}`);
  console.log(`Downloaded ${imgCount} thumbnail(s); failures: ${failCount}`);
}

main().catch(err=>{ console.error(err); process.exit(1); });

