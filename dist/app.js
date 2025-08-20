const manifestUrl = new URL('./manifest.json', location.href).href;

const els = {
  grid: document.getElementById('grid'),
  search: document.getElementById('search'),
  category: document.getElementById('category'),
  counts: document.getElementById('counts'),
};

const state = { data: [], categories: [], q: '', cat: '' };

const html = (s,...v)=>{ const t=document.createElement('template'); t.innerHTML=s.reduce((a,c,i)=>a+c+(i<v.length?v[i]:''),'').trim(); return t.content.firstElementChild; };
const norm = s => (s||'').toLowerCase();

function heroThumb(pack){
  const pages = pack.pages||[];
  const home = pages.find(p=>/home-page$/i.test(p.layout_slug));
  return (home||pages[0]||{}).thumbnail || '';
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
        <img class="thumb" loading="lazy" decoding="async" alt="${pack.pack_name} – ${page.page_name}" src="${page.thumbnail||''}">
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
  let packs = state.data;
  if (q) packs = packs.filter(p => norm(p.pack_name).includes(q));
  if (cat) packs = packs.filter(p => norm(p.category)===cat);
  els.grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const pack of packs) frag.appendChild(renderPackCard(pack));
  els.grid.appendChild(frag);
  els.counts.textContent = `${packs.length} pack(s)`;
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

async function main(){
  const res = await fetch(manifestUrl); const data = await res.json();
  state.data = (data.items||[]);
  state.categories = Array.from(new Set(state.data.map(p=>p.category))).sort((a,b)=> a.localeCompare(b));
  for (const cat of state.categories){ const o=document.createElement('option'); o.value=cat; o.textContent=cat; els.category.appendChild(o); }
  els.search.addEventListener('input', e=>{ state.q=e.target.value; applyFilters(); });
  els.category.addEventListener('change', e=>{ state.cat=e.target.value; applyFilters(); });
  const dl = document.getElementById('download-offline'); if (dl) dl.addEventListener('click', downloadOffline);
  applyFilters();
}

main().catch(err=>{ els.counts.textContent = 'Failed to load'; console.error(err); });

