const manifestUrl = new URL('./manifest.json', location.href).href;

const els = {
  grid: document.getElementById('grid'),
  search: document.getElementById('search'),
  category: document.getElementById('category'),
  counts: document.getElementById('counts'),
};

const state = {
  data: [],
  flat: [], // flattened pages
  categories: [],
  q: '',
  cat: '',
};

function html(strings, ...vals){
  const s = strings.reduce((acc,cur,i)=> acc + cur + (i<vals.length?vals[i]:''), '');
  const t = document.createElement('template');
  t.innerHTML = s.trim();
  return t.content.firstElementChild;
}

function normalize(str){
  return (str||'').toLowerCase();
}

function flatten(items){
  const out = [];
  for (const pack of items){
    for (const page of (pack.pages||[])){
      out.push({
        pack_id: pack.pack_id,
        pack_name: pack.pack_name,
        category: pack.category,
        page_name: page.page_name,
        layout_slug: page.layout_slug,
        layout_url: page.layout_url,
        demo_url: page.demo_url,
        thumbnail: page.thumbnail || '',
      });
    }
  }
  return out;
}

function renderCard(row){
  const thumb = row.thumbnail || '';
  const el = html`
    <article class="card" data-pack="${row.pack_id}" data-cat="${row.category}">
      <img class="thumb" loading="lazy" decoding="async" alt="${row.pack_name} – ${row.page_name}" src="${thumb}">
      <div class="meta">
        <div class="title">${row.pack_name} · ${row.page_name}</div>
        <div class="row small">
          <span>${row.category}</span>
          <span>·</span>
          <span>${row.layout_slug}</span>
        </div>
      </div>
      <div class="actions">
        <a class="btn" href="${row.layout_url}" target="_blank" rel="noopener">Layout</a>
        <a class="btn" href="${row.demo_url}" target="_blank" rel="noopener">Live Demo</a>
        <button class="btn copy" data-url="${thumb}">Copy image URL</button>
      </div>
    </article>`;
  el.querySelector('.copy').addEventListener('click', async (e)=>{
    const url = e.currentTarget.dataset.url;
    try { await navigator.clipboard.writeText(url); e.currentTarget.textContent = 'Copied!'; setTimeout(()=> e.currentTarget.textContent='Copy image URL', 1200);} catch {}
  });
  return el;
}

function applyFilters(){
  const q = normalize(state.q);
  const cat = normalize(state.cat);
  let rows = state.flat;
  if (q){
    rows = rows.filter(r => normalize(r.pack_name).includes(q) || normalize(r.page_name).includes(q) || normalize(r.layout_slug).includes(q));
  }
  if (cat){ rows = rows.filter(r => normalize(r.category) === cat); }
  els.grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const row of rows){ frag.appendChild(renderCard(row)); }
  els.grid.appendChild(frag);
  els.counts.textContent = `${rows.length} result(s)`;
}

async function main(){
  const res = await fetch(manifestUrl);
  const data = await res.json();
  state.data = data.items || [];
  state.flat = flatten(state.data);
  state.categories = Array.from(new Set(state.flat.map(r => r.category))).sort((a,b)=> a.localeCompare(b));

  // Fill categories
  for (const cat of state.categories){
    const opt = document.createElement('option');
    opt.value = cat; opt.textContent = cat; els.category.appendChild(opt);
  }

  els.search.addEventListener('input', (e)=>{ state.q = e.target.value; applyFilters(); });
  els.category.addEventListener('change', (e)=>{ state.cat = e.target.value; applyFilters(); });

  applyFilters();
}

main().catch(err=>{
  els.counts.textContent = 'Failed to load manifest';
  console.error(err);
});

