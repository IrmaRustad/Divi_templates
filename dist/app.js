const manifestUrl = new URL('./manifest.json', location.href).href;

const els = {
  grid: document.getElementById('grid'),
  search: document.getElementById('search'),
  category: document.getElementById('category'),
  types: document.getElementById('types'),
  counts: document.getElementById('counts'),
  facetBg: document.getElementById('facet-bg'),
  facetColor: document.getElementById('facet-color'),
  facetMood: document.getElementById('facet-mood'),
  facetDensity: document.getElementById('facet-density'),
  facetContrast: document.getElementById('facet-contrast'),
  minPages: document.getElementById('min-pages'),
  approvedOnly: document.getElementById('approved-only'),
  hasThumb: document.getElementById('has-thumb'),
};

const state = { data: [], categories: [], q: '', cat: '', types: new Set(),
  filters: { bg:'', color:'', mood:'', density:'', contrast:'', minPages:0, approvedOnly:false, hasThumb:false }
};

const html = (s,...v)=>{ const t=document.createElement('template'); t.innerHTML=s.reduce((a,c,i)=>a+c+(i<v.length?v[i]:''),'').trim(); return t.content.firstElementChild; };
const norm = s => (s||'').toLowerCase();
const isRemote = u => /^https?:\/\//i.test(u||'');
function localThumb(pack, page){
  const cat = (pack && pack.category) ? String(pack.category) : 'pack';
  const slug = (page && page.layout_slug) ? page.layout_slug : (pack?.pack_id||'');
  // Prefer the declared category path, fall back to pack/ for local subsets
  return `thumbs/${cat}/${slug}.webp`;
}
function heroThumb(pack){
  const pages = pack.pages||[];
  const home = pages.find(p=>/home-page$/i.test(p.layout_slug));
  const chosen = (home||pages[0]||{});
  const th = chosen.thumbnail||'';
  return isRemote(th) ? localThumb(pack, chosen) : th;
}

function renderPackCard(pack){
  const el = html`
    <article class="card pack" data-pack="${pack.pack_id}" data-cat="${pack.category}">
      <img class="thumb" loading="lazy" decoding="async" alt="${pack.pack_name}" src="${heroThumb(pack)}">
      <div class="meta">
        <div class="title">${pack.pack_name}</div>
        <div class="row small"><span>${pack.category}</span><span>·</span><span>${(pack.pages||[]).length} pages</span></div>
      </div>
      <div class="actions"><button class="btn expand">View Pages</button></div>
      <section class="pack-pages" hidden></section>
    </article>`;
  el.querySelector('.expand').addEventListener('click', ()=>togglePack(el, pack));
  return el;
}

function renderPackPages(pack){
  const sec = document.createElement('div');
  sec.className = 'pages-grid';
  for (const page of (pack.pages||[])){
    const row = html`
      <div class="page">
        <img class="thumb" loading="lazy" decoding="async" alt="${pack.pack_name} – ${page.page_name}" src="${isRemote(page.thumbnail)?localThumb(pack,page):page.thumbnail||''}">
        <div class="title small">${page.page_name}</div>
        <div class="row">
          <a class="btn" href="${page.layout_url}" target="_blank" rel="noopener">Layout</a>
          <a class="btn" href="${page.demo_url}" target="_blank" rel="noopener">Live Demo</a>
        </div>
      </div>`;
    sec.appendChild(row);
  }
  return sec;
}

function togglePack(card, pack){
  const sec = card.querySelector('.pack-pages');
  if (!sec.hasChildNodes()) sec.appendChild(renderPackPages(pack));
  const hidden = sec.hasAttribute('hidden');
  if (hidden) sec.removeAttribute('hidden'); else sec.setAttribute('hidden','');
}

function applyFilters(){
  const q = norm(state.q); const cat = norm(state.cat);
  const types = state.types;
  const f = state.filters;
  let packs = state.data;
  if (q) packs = packs.filter(p => norm(p.pack_name).includes(q) || norm(p.category).includes(q));
  if (cat) packs = packs.filter(p => norm(p.category)===cat);
  if (types && types.size){
    packs = packs.filter(p => {
      const slugs = new Set((p.pages||[]).map(pg=>String(pg.layout_slug||'')));
      for (const t of types){ if ([...slugs].some(s=> new RegExp(`-${t}-page$`).test(s))) return true; }
      return false;
    });
  }
  // facet filters (pack.facets)
  packs = packs.filter(p => {
    const fac = p.facets||{};
    if (f.bg && fac.background_style !== f.bg) return false;
    if (f.color && fac.colorfulness !== f.color) return false;
    if (f.mood && fac.font_mood !== f.mood) return false;
    if (f.density && fac.visual_density !== f.density) return false;
    if (f.contrast && fac.wcag_contrast !== f.contrast) return false;
    if (f.approvedOnly && p.approved !== true) return false;
    if (f.minPages && (p.pages||[]).length < Number(f.minPages||0)) return false;
    if (f.hasThumb){
      const has = (p.pages||[]).some(pg => !!pg.thumbnail);
      if (!has) return false;
    }
    return true;
  });
  els.grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const pack of packs) frag.appendChild(renderPackCard(pack));
  els.grid.appendChild(frag);
  const pageCount = packs.reduce((a,p)=>a+(p.pages||[]).length,0);
  els.counts.textContent = `${packs.length} pack(s) · ${pageCount} page(s)`;
}

async function downloadOffline(){
  if (!window.JSZip){ alert('Offline download not available'); return; }
  const btnTxt = 'Preparing…';
  const zip = new JSZip();
  const add = (p,blob)=> zip.file(p, blob);
  const res = await fetch(manifestUrl); const manifest = await res.json();
  add('manifest.json', JSON.stringify(manifest, null, 2));
  const urls = [];
  for (const pack of (manifest.items||[])) for (const page of (pack.pages||[])) if (page.thumbnail){ urls.push({ url: page.thumbnail, path: `thumbs/${pack.category}/${page.layout_slug}.webp` }); }
  let done=0; els.counts.textContent = `Downloading ${urls.length} images…`;
  for (const u of urls){
    try{ const r = await fetch(u.url); const b = await r.blob(); add(u.path, b); } catch {}
    done++; if (done%20===0) els.counts.textContent = `Downloading ${done}/${urls.length}…`;
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'divi_catalog_offline.zip'; a.click();
  els.counts.textContent = `Ready · ${state.data.length} pack(s)`;
}
  // Build quick page-type chips from slugs present across all packs
  const allTypes = new Set();
  for (const pack of state.data){
    for (const page of (pack.pages||[])){
      const m = /-([a-z0-9]+)-page$/i.exec(page.layout_slug||'');
      if (m && m[1]) allTypes.add(m[1]);
    }
  }
  const types = Array.from(allTypes).sort();
  for (const t of types){
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.textContent = t;
    chip.addEventListener('click', ()=>{
      if (state.types.has(t)) state.types.delete(t); else state.types.add(t);
      chip.classList.toggle('active');
      applyFilters();
    });
    els.types.appendChild(chip);
  }


async function main(){
  const res = await fetch(manifestUrl); const data = await res.json();
  state.data = (data.items||[]);
  const cats = state.data.map(p => p && p.category ? String(p.category) : 'uncategorized');
  state.categories = Array.from(new Set(cats)).sort((a,b)=> String(a).localeCompare(String(b)));
  for (const cat of state.categories){ const o=document.createElement('option'); o.value=cat; o.textContent=cat; els.category.appendChild(o); }
  // populate facet selects from schema enums
  const enums = {
    bg: ['light','dark','colorful'],
    color: ['low','medium','high'],
    mood: ['modern','classic','playful','technical'],
    density: ['airy','balanced','dense'],
    contrast: ['pass','warn']
  };
  function fillSelect(sel, arr){ if(!sel) return; for(const v of arr){ const o=document.createElement('option'); o.value=v; o.textContent=`${v}`; sel.appendChild(o);} }
  fillSelect(els.facetBg, enums.bg);
  fillSelect(els.facetColor, enums.color);
  fillSelect(els.facetMood, enums.mood);
  fillSelect(els.facetDensity, enums.density);
  fillSelect(els.facetContrast, enums.contrast);
  els.search.addEventListener('input', e=>{ state.q=e.target.value; applyFilters(); });
  els.category.addEventListener('change', e=>{ state.cat=e.target.value; applyFilters(); });
  // facet listeners
  if (els.facetBg) els.facetBg.addEventListener('change', e=>{ state.filters.bg=e.target.value; applyFilters(); });
  if (els.facetColor) els.facetColor.addEventListener('change', e=>{ state.filters.color=e.target.value; applyFilters(); });
  if (els.facetMood) els.facetMood.addEventListener('change', e=>{ state.filters.mood=e.target.value; applyFilters(); });
  if (els.facetDensity) els.facetDensity.addEventListener('change', e=>{ state.filters.density=e.target.value; applyFilters(); });
  if (els.facetContrast) els.facetContrast.addEventListener('change', e=>{ state.filters.contrast=e.target.value; applyFilters(); });
  if (els.minPages) els.minPages.addEventListener('input', e=>{ state.filters.minPages=parseInt(e.target.value||'0',10)||0; applyFilters(); });
  if (els.approvedOnly) els.approvedOnly.addEventListener('change', e=>{ state.filters.approvedOnly=!!e.target.checked; applyFilters(); });
  if (els.hasThumb) els.hasThumb.addEventListener('change', e=>{ state.filters.hasThumb=!!e.target.checked; applyFilters(); });
  const dl = document.getElementById('download-offline'); if (dl) dl.addEventListener('click', downloadOffline);
  applyFilters();
}

main().catch(err=>{ els.counts.textContent = 'Failed to load'; console.error(err); });

