// ============================================================
// Rockford Sanborn Fire Insurance Maps
// Studio GWA — app.js
//
// Mapbox GL JS basemap + Sanborn sheets drawn by Allmaps (vendor/allmaps-mapbox.js)
// + the Studio GWA historic industrial property survey.
// ============================================================

mapboxgl.accessToken = CONFIG.MAPBOX_TOKEN;

let map;
let sanborn = null;            // Allmaps warped-map layer (null if it could not start)
let parcelsData = null;        // survey parcel polygons
let centroidsData = null;      // survey parcel centroids
let parcelsById = {};
let selectedId = null;
let hoveredFeatureId = null;

const annotationCache = {};    // volume id -> annotation JSON
let labelByResource = {};      // image service id -> { item, sheet } for the edition on screen
let loadToken = 0;             // guards against out-of-order edition loads
let statusTimer = null;
let sheetPopup = null;
let currentSheets = { type: 'FeatureCollection', features: [] };

const state = {
  year: CONFIG.DEFAULT_YEAR,   // an edition id, or "today"
  opacity: CONFIG.DEFAULT_OPACITY,
  sheetCount: 0,
  base: 'grayscale',
};

// Base maps the viewer can switch between.
function baseList() {
  const list = [
    { id: 'grayscale', label: 'Grayscale' },
    { id: 'aerial', label: 'Aerial' },
  ];
  if (CONFIG.STADIA && CONFIG.STADIA.ENABLED) list.push({ id: 'osm', label: CONFIG.STADIA.LABEL });
  return list;
}
let baseLayerIds = [];        // layers that belong to the Mapbox Light style
let baseLabelPaint = {};      // original label colors, restored when returning to Grayscale

const els = {
  splash: document.getElementById('splash'),
  splashProgress: document.getElementById('splash-progress'),
  splashStatus: document.getElementById('splash-status'),
  hed: document.getElementById('hed'),
  headerSub: document.getElementById('header-sub'),
  searchInput: document.getElementById('search-input'),
  searchBox: document.querySelector('.search-box'),
  searchClear: document.getElementById('search-clear'),
  searchResults: document.getElementById('search-results'),
  emptyState: document.getElementById('empty-state'),
  snapshot: document.getElementById('snapshot'),
  snapshotBack: document.getElementById('snapshot-back'),
  snapAddress: document.getElementById('snap-address'),
  snapBuildingName: document.getElementById('snap-buildingname'),
  snapCopy: document.getElementById('snap-copy'),
  snapShare: document.getElementById('snap-share'),
  snapToast: document.getElementById('snap-toast'),
  snapFacts: document.getElementById('snap-facts'),
  snapNotesWrap: document.getElementById('snap-notes-wrap'),
  snapNotes: document.getElementById('snap-notes'),
  mapStatus: document.getElementById('map-status'),
};

// ---------------- Small helpers ----------------
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtNum(v) {
  if (v === null || v === undefined || v === '') return null;
  return v;
}
function setSplashProgress(pct, label) {
  els.splashProgress.style.width = pct + '%';
  if (label) els.splashStatus.textContent = label;
}
function hideSplash() {
  setTimeout(() => els.splash.classList.add('splash-hidden'), 350);
}
function showStatus(text, isError, autoHideMs) {
  clearTimeout(statusTimer);
  els.mapStatus.textContent = text;
  els.mapStatus.classList.toggle('is-error', !!isError);
  els.mapStatus.classList.remove('hidden');
  if (autoHideMs) statusTimer = setTimeout(hideStatus, autoHideMs);
}
function hideStatus() {
  clearTimeout(statusTimer);
  els.mapStatus.classList.add('hidden');
}
function boundsOfGeometry(geometry) {
  const bounds = new mapboxgl.LngLatBounds();
  const walk = (coords) => {
    if (typeof coords[0] === 'number') bounds.extend(coords);
    else coords.forEach(walk);
  };
  walk(geometry.coordinates);
  return bounds;
}
function yearDef(id) {
  return CONFIG.YEARS.find((y) => y.id === id);
}
function webglOk() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
}

// ---------------- Map init ----------------
map = new mapboxgl.Map({
  container: 'map',
  style: CONFIG.MAPBOX_STYLE,
  center: CONFIG.INITIAL_CENTER,
  zoom: CONFIG.INITIAL_ZOOM,
  attributionControl: false,
});
map.addControl(new mapboxgl.AttributionControl({
  compact: true,
  customAttribution: [
    'Sanborn maps: Library of Congress',
    'placed by <a href="https://mapsnap.org" target="_blank" rel="noopener">mapsnap</a> (&copy; OpenStreetMap contributors)',
  ],
}));
map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'top-right');

map.on('load', init);
map.on('error', (e) => {
  // Basemap tile hiccups are not worth interrupting the viewer for; keep them in the console.
  if (e && e.error) console.warn('map error:', e.error.message || e.error);
});

async function init() {
  if (location.protocol === 'file:') {
    els.splashStatus.innerHTML = 'This page can&rsquo;t load its data when opened as a file.<br>Run <code>python3 -m http.server 8000</code> in this folder, then open <b>http://localhost:8000</b> &mdash; or publish it to GitHub Pages.';
    return;
  }
  buildControls();
  readUrlState();
  syncControls();

  setSplashProgress(15, 'Loading survey and boundary data…');
  const [parcels, centroids] = await Promise.all([
    fetch(CONFIG.DATA.parcels).then((r) => r.json()),
    fetch(CONFIG.DATA.centroids).then((r) => r.json()),
  ]);

  setSplashProgress(45, 'Indexing surveyed properties…');
  parcelsData = parcels;
  centroidsData = centroids;
  parcelsData.features.forEach((f) => (parcelsById[f.properties.id] = f));

  // Historic sheets and their outlines go in beneath the basemap's labels, so street names stay readable.
  baseLayerIds = map.getStyle().layers.map((l) => l.id);
  const firstSymbol = (map.getStyle().layers.find((l) => l.type === 'symbol') || {}).id;

  setSplashProgress(60, 'Preparing the Sanborn layer…');
  if (window.AllmapsMapbox && webglOk()) {
    sanborn = new AllmapsMapbox.WarpedMapLayer({ layerId: 'sanborn' });
    map.addLayer(sanborn, firstSymbol);
    sanborn.setOpacity(state.opacity);
  } else {
    showStatus('This browser cannot draw the historic maps (WebGL 2 is required). The survey layers still work.', true);
  }

  map.addSource('sheets', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'sheets-fill', type: 'fill', source: 'sheets', paint: { 'fill-color': '#779354', 'fill-opacity': 0.01 } }, firstSymbol);
  map.addLayer({
    id: 'sheets-outline', type: 'line', source: 'sheets',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#454948', 'line-width': 1, 'line-opacity': 0.7, 'line-dasharray': [3, 2] },
  }, firstSymbol);

  map.addSource('parcels-poly', { type: 'geojson', data: parcelsData, promoteId: 'id' });

  // Survey parcels stay on the map only as invisible hit areas (search and clicking still work);
  // a property is outlined only while it is selected.
  map.addLayer({
    id: 'parcels-fill', type: 'fill', source: 'parcels-poly',
    paint: {
      'fill-color': '#7ba457',
      'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.3, 0.005],
    },
  });
  map.addLayer({
    id: 'parcels-outline', type: 'line', source: 'parcels-poly',
    paint: {
      'line-color': '#96ac53',
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3.5, 0],
    },
  });
  applyBase(state.base, { initial: true });

  bindMapInteractions();
  bindUI();
  bindMobileLayersControl();
  initSheet();

  setSplashProgress(80, 'Loading Sanborn sheets…');
  await setYear(state.year, { initial: true });

  setSplashProgress(100, 'Ready.');
  hideSplash();
  checkDeepLink();
}

// ---------------- Controls (edition, opacity, layers) ----------------
// The same markup is built twice: once in the sidebar (desktop) and once in the
// floating panel (mobile). Both stay in sync through the shared `state`.
function controlsHTML() {
  const years = CONFIG.YEARS.map((y) => `<button type="button" class="year-btn" data-year="${esc(y.id)}">${esc(y.label)}</button>`).join('');
  const bases = baseList().map((b) => `<button type="button" class="year-btn" data-base="${esc(b.id)}">${esc(b.label)}</button>`).join('');
  return `
    <div class="ctl-block">
      <h3 class="ctl-hed">Sanborn edition</h3>
      <div class="year-seg">${years}</div>
      <button type="button" class="year-today" data-year="today">Today&rsquo;s map only</button>
      <p class="edition-note"><span class="edition-note-text"></span><button type="button" class="link-btn" data-act="zoom">Zoom to edition</button></p>
    </div>
    <div class="ctl-block">
      <h3 class="ctl-hed">Opacity of historic sheets</h3>
      <div class="opacity-row">
        <input type="range" class="opacity-range" min="0" max="100" step="1" aria-label="Opacity of historic sheets" />
        <span class="opacity-out"></span>
      </div>
      <div class="opacity-ends"><span>Today</span><span>1900s</span></div>
    </div>
    <div class="ctl-block">
      <h3 class="ctl-hed">Base map</h3>
      <div class="year-seg base-seg">${bases}</div>
    </div>`;
}

function buildControls() {
  document.getElementById('controls-desktop').innerHTML = controlsHTML();
  document.getElementById('mobile-layers-panel').innerHTML = controlsHTML();

  document.addEventListener('click', (e) => {
    const yearBtn = e.target.closest('[data-year]');
    if (yearBtn) { setYear(yearBtn.dataset.year); return; }
    const baseBtn = e.target.closest('[data-base]');
    if (baseBtn) { applyBase(baseBtn.dataset.base); return; }
    const zoomBtn = e.target.closest('[data-act="zoom"]');
    if (zoomBtn) zoomToEdition();
  });
  document.addEventListener('input', (e) => {
    if (!e.target.classList.contains('opacity-range')) return;
    state.opacity = Number(e.target.value) / 100;
    if (sanborn) sanborn.setOpacity(state.opacity);
    syncControls();
    writeUrlState();
  });
}

// Push the current state into every copy of the controls.
function syncControls() {
  document.querySelectorAll('[data-year]').forEach((b) => b.classList.toggle('is-active', b.dataset.year === state.year));
  document.querySelectorAll('.opacity-range').forEach((r) => { r.value = Math.round(state.opacity * 100); });
  document.querySelectorAll('.opacity-out').forEach((o) => { o.textContent = Math.round(state.opacity * 100) + '%'; });
  document.querySelectorAll('[data-base]').forEach((b) => b.classList.toggle('is-active', b.dataset.base === state.base));
  const def = yearDef(state.year);
  const note = state.year === 'today'
    ? 'Showing today’s map only.'
    : def ? `${def.note}${state.sheetCount ? ` · ${state.sheetCount} sheets` : ''}` : '';
  document.querySelectorAll('.edition-note-text').forEach((n) => { n.textContent = note; });
  document.querySelectorAll('[data-act="zoom"]').forEach((b) => { b.style.display = state.year === 'today' || !state.sheetCount ? 'none' : ''; });
  els.hed.innerHTML = state.year === 'today'
    ? 'What stands here<br/><em>today?</em>'
    : `What stood here<br/><em>in ${esc(state.year)}?</em>`;
  els.headerSub.textContent = state.year === 'today'
    ? 'Today’s map'
    : `${state.year} Sanborn edition${state.sheetCount ? ` · ${state.sheetCount} sheets` : ''}`;
}

function stadiaTileUrl() {
  const c = CONFIG.STADIA;
  const key = c.API_KEY ? `?api_key=${encodeURIComponent(c.API_KEY)}` : '';
  return `https://tiles.stadiamaps.com/tiles/${c.STYLE}/{z}/{x}/{y}${c.RETINA ? '@2x' : ''}.${c.EXT || 'png'}${key}`;
}

// Switch base map without touching the Sanborn layer: the Mapbox Light style stays loaded,
// and Aerial is a raster layer slid in underneath it.
function applyBase(id, opts) {
  if (!baseList().some((b) => b.id === id)) id = 'grayscale';
  state.base = id;
  const bottom = baseLayerIds[0];

  if (!map.getSource('base-aerial')) {
    map.addSource('base-aerial', { type: 'raster', url: 'mapbox://mapbox.satellite', tileSize: 256 });
    map.addLayer({ id: 'base-aerial', type: 'raster', source: 'base-aerial', layout: { visibility: 'none' } }, bottom);
  }
  if (CONFIG.STADIA && CONFIG.STADIA.ENABLED && !map.getSource('base-osm')) {
    map.addSource('base-osm', {
      type: 'raster', tiles: [stadiaTileUrl()], tileSize: 256, maxzoom: 20,
      attribution: '&copy; <a href="https://stadiamaps.com/" target="_blank" rel="noopener">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    });
    map.addLayer({ id: 'base-osm', type: 'raster', source: 'base-osm', layout: { visibility: 'none' } }, bottom);
  }

  const vis = (layerId, on) => { if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', on ? 'visible' : 'none'); };
  vis('base-aerial', id === 'aerial');
  vis('base-osm', id === 'osm');

  baseLayerIds.forEach((lid) => {
    const layer = map.getLayer(lid);
    if (!layer) return;
    if (id === 'grayscale') vis(lid, true);
    else if (id === 'aerial') vis(lid, layer.type === 'symbol');   // keep street and place labels over the photo
    else vis(lid, false);                                           // OSM Light tiles carry their own labels
  });

  // Labels need to read on photography: white text with a dark halo.
  baseLayerIds.forEach((lid) => {
    const layer = map.getLayer(lid);
    if (!layer || layer.type !== 'symbol') return;
    if (!(lid in baseLabelPaint)) baseLabelPaint[lid] = [map.getPaintProperty(lid, 'text-color'), map.getPaintProperty(lid, 'text-halo-color')];
    const [tc, hc] = baseLabelPaint[lid];
    const aerial = id === 'aerial';
    map.setPaintProperty(lid, 'text-color', aerial ? '#ffffff' : (tc === undefined ? null : tc));
    map.setPaintProperty(lid, 'text-halo-color', aerial ? 'rgba(0,0,0,0.65)' : (hc === undefined ? null : hc));
  });

  syncControls();
  if (!(opts && opts.initial)) writeUrlState();
}

function bindMobileLayersControl() {
  const toggle = document.getElementById('mobile-layers-toggle');
  const panel = document.getElementById('mobile-layers-panel');
  const wrap = document.getElementById('mobile-layers');
  if (!toggle || !panel || !wrap) return;
  toggle.addEventListener('click', () => {
    const open = panel.classList.toggle('hidden') === false;
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      panel.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// ---------------- Sanborn editions ----------------
async function loadAnnotation(volumeId) {
  if (annotationCache[volumeId]) return annotationCache[volumeId];
  const url = `${CONFIG.IIIF_ROOT}${CONFIG.IMAGE_SOURCE}/${volumeId}.main.iiif.json?v=${BUILD}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${volumeId}: HTTP ${res.status}`);
  const json = await res.json();
  annotationCache[volumeId] = json;
  return json;
}

function parseSheetLabel(label) {
  // "Rockford, Illinois | 1913 | sanborn02127_004 p12"
  const m = /(sanborn\d+_\d+)\s+(\S+)\s*$/.exec(label || '');
  if (!m) return { item: null, sheet: null };
  let sheet = m[2].replace(/^p/i, '');
  const part = /^(\d+)__(\d+)$/.exec(sheet);
  if (part) sheet = `${part[1]}, part ${part[2]}`;
  return { item: m[1], sheet };
}

async function setYear(id, opts) {
  const options = opts || {};
  const token = ++loadToken;
  state.year = id;
  state.sheetCount = 0;
  hidePopup();
  setSheets({ type: 'FeatureCollection', features: [] });
  if (sanborn) sanborn.clear();
  syncControls();
  writeUrlState();

  if (id === 'today' || !sanborn) { hideStatus(); return; }

  const def = yearDef(id);
  if (!def) return;
  showStatus(`Loading ${def.label} sheets…`);

  try {
    const annotations = await Promise.all(def.volumes.map(loadAnnotation));
    if (token !== loadToken) return;   // the viewer picked another edition meanwhile

    labelByResource = {};
    annotations.forEach((a) => (a.items || []).forEach((it) => {
      const src = it.target && it.target.source && it.target.source.id;
      if (src) labelByResource[src] = parseSheetLabel(it.label);
    }));
    for (const a of annotations) sanborn.addGeoreferenceAnnotation(a);

    const outlines = AllmapsMapbox.sheetOutlines(sanborn);
    outlines.features.forEach((f) => {
      const info = labelByResource[f.properties.resourceId] || {};
      f.properties.item = info.item || '';
      f.properties.sheet = info.sheet || '';
    });
    setSheets(outlines);
    state.sheetCount = outlines.features.length;
    syncControls();

    if (options.initial) hideStatus();
    else showStatus(`${def.label} sheets loading… images appear as they arrive.`, false, 6000);
  } catch (err) {
    if (token !== loadToken) return;
    console.error(err);
    showStatus(`Could not load the ${def.label} sheets (${err.message}).`, true);
  }
}

function setSheets(fc) {
  currentSheets = fc;
  const src = map.getSource('sheets');
  if (src) src.setData(fc);
}

function zoomToEdition() {
  if (!currentSheets.features.length) return;
  const bounds = new mapboxgl.LngLatBounds();
  currentSheets.features.forEach((f) => boundsOfGeometry(f.geometry).toArray().forEach((c) => bounds.extend(c)));
  map.fitBounds(bounds, { padding: framingPadding(), duration: 900 });
}

function hidePopup() {
  if (sheetPopup) { sheetPopup.remove(); sheetPopup = null; }
}

// ---------------- URL state ----------------
function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const y = params.get('y');
  if (y === 'today' || (y && yearDef(y))) state.year = y;
  const o = Number(params.get('o'));
  const b = params.get('b');
  if (b && baseList().some((x) => x.id === b)) state.base = b;
  if (params.has('o') && isFinite(o) && o >= 0 && o <= 100) state.opacity = o / 100;
}

function writeUrlState() {
  const url = new URL(window.location.href);
  if (state.year === CONFIG.DEFAULT_YEAR) url.searchParams.delete('y'); else url.searchParams.set('y', state.year);
  if (state.base === 'grayscale') url.searchParams.delete('b'); else url.searchParams.set('b', state.base);
  if (Math.abs(state.opacity - CONFIG.DEFAULT_OPACITY) < 0.005) url.searchParams.delete('o');
  else url.searchParams.set('o', String(Math.round(state.opacity * 100)));
  window.history.replaceState({}, '', url);
}

// ---------------- Mobile bottom sheet ----------------
// Only affects layout under the 860px breakpoint defined in style.css.
// Three snap positions: collapsed (handle + search), half, full.
const SHEET_PEEK_PX = 108;
const SHEET_HALF_RATIO = 0.48;
const SHEET_FULL_MARGIN_PX = 56;

let sheetExpandFn = null;
let sheetCollapseFn = null;

function initSheet() {
  const sidebar = document.getElementById('sidebar');
  const handle = document.getElementById('sheet-handle');
  if (!sidebar || !handle) return;

  const isMobile = () => window.matchMedia('(max-width: 860px)').matches;
  const snapPoints = () => {
    const h = sidebar.offsetHeight || window.innerHeight;
    return {
      collapsed: Math.max(0, h - SHEET_PEEK_PX),
      half: Math.max(0, h * (1 - SHEET_HALF_RATIO)),
      full: Math.max(0, SHEET_FULL_MARGIN_PX),
    };
  };

  let sheetState = 'collapsed';
  let currentY = snapPoints().collapsed;

  function applyY(y, animate) {
    currentY = y;
    sidebar.classList.toggle('sheet-dragging', !animate);
    sidebar.style.setProperty('--sheet-y', `${y}px`);
  }
  function goTo(next) {
    sheetState = next;
    applyY(snapPoints()[next], true);
  }
  function nearestState(y) {
    const pts = snapPoints();
    let best = 'collapsed', bestDist = Infinity;
    for (const key of Object.keys(pts)) {
      const d = Math.abs(pts[key] - y);
      if (d < bestDist) { bestDist = d; best = key; }
    }
    return best;
  }
  const cycle = { collapsed: 'half', half: 'full', full: 'collapsed' };

  sheetExpandFn = () => { if (isMobile()) goTo('half'); };
  sheetCollapseFn = () => { if (isMobile()) goTo('collapsed'); };

  window.addEventListener('resize', () => {
    if (!isMobile()) return;
    applyY(snapPoints()[sheetState], true);
  });

  let dragging = false, moved = false, startY = 0, startTranslate = 0;
  function onPointerDown(e) {
    if (!isMobile()) return;
    dragging = true; moved = false; startY = e.clientY; startTranslate = currentY;
    applyY(currentY, false);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 4) moved = true;
    const pts = snapPoints();
    applyY(Math.max(pts.full, Math.min(pts.collapsed, startTranslate + dy)), false);
  }
  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    goTo(moved ? nearestState(currentY) : cycle[sheetState]);
  }
  handle.addEventListener('pointerdown', onPointerDown);
  requestAnimationFrame(() => goTo('collapsed'));
}

function framingPadding() {
  const isMobile = window.matchMedia('(max-width: 860px)').matches;
  if (!isMobile) return { top: 80, bottom: 80, left: 80, right: 80 };
  const headerH = 72;
  const sheetHalfPx = Math.round((window.innerHeight - headerH) * 0.48);
  return { top: 50, bottom: sheetHalfPx + 40, left: 40, right: 40 };
}

// ---------------- Map interactions ----------------
function bindMapInteractions() {
  // Surveyed properties are reached through search; they are not drawn or clickable on the map.

  // Clicking a sheet opens its Library of Congress record.
  map.on('click', 'sheets-fill', (e) => {
    const f = e.features && e.features[0];
    if (!f) return;
    const p = f.properties;
    const vol = CONFIG.VOLUMES[p.item] || '';
    hidePopup();
    const link = p.item ? `https://www.loc.gov/item/${encodeURIComponent(p.item)}/` : 'https://www.loc.gov/collections/sanborn-maps/';
    sheetPopup = new mapboxgl.Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div class="mp-title">Sanborn ${esc(vol)}</div>
        <div class="mp-sub">${p.sheet ? 'Sheet ' + esc(p.sheet) + ' · ' : ''}Rockford, Winnebago County, Illinois</div>
        <a class="mp-btn" href="${link}" target="_blank" rel="noopener">Open at Library of Congress &#8599;</a>`)
      .addTo(map);
  });
  map.on('mouseenter', 'sheets-fill', () => { if (!map.getCanvas().style.cursor) map.getCanvas().style.cursor = 'help'; });
  map.on('mouseleave', 'sheets-fill', () => { if (map.getCanvas().style.cursor === 'help') map.getCanvas().style.cursor = ''; });

  // Allmaps reports image loading through map events (see adapter).
  map.on('allrequestedtilesloaded', () => { if (!els.mapStatus.classList.contains('is-error')) hideStatus(); });
}

// ---------------- Search ----------------
function bindUI() {
  els.searchInput.addEventListener('input', onSearchInput);
  els.searchClear.addEventListener('click', () => {
    els.searchInput.value = '';
    els.searchBox.classList.remove('has-value');
    els.searchResults.innerHTML = '';
  });
  els.snapshotBack.addEventListener('click', deselectParcel);
  els.snapCopy.addEventListener('click', copyShareLink);
  els.snapShare.addEventListener('click', shareParcel);
}

function onSearchInput() {
  const q = els.searchInput.value.trim().toLowerCase();
  els.searchBox.classList.toggle('has-value', q.length > 0);
  if (q) sheetExpandFn?.();
  if (!q) { els.searchResults.innerHTML = ''; return; }

  const matches = parcelsData.features.filter((f) => {
    const p = f.properties;
    return (
      (p.address && p.address.toLowerCase().includes(q)) ||
      (p.building_name && p.building_name.toLowerCase().includes(q)) ||
      (p.current_owner && p.current_owner.toLowerCase().includes(q)) ||
      (p.original_industry && p.original_industry.toLowerCase().includes(q))
    );
  }).slice(0, 12);

  if (!matches.length) {
    els.searchResults.innerHTML = '<div class="search-no-results">No surveyed properties match that search.</div>';
    return;
  }
  els.searchResults.innerHTML = matches.map((f) => {
    const p = f.properties;
    const flags = [];
    if (p.tif === 'Y') flags.push('<span class="sr-flag on-tif">TIF</span>');
    if (p.oz === 'Y') flags.push('<span class="sr-flag on-oz">OZ</span>');
    if (p.rerz === 'Y') flags.push('<span class="sr-flag on-rerz">RERZ</span>');
    return `<div class="search-result-item" data-id="${esc(p.id)}">
      <div class="sr-title">${esc(p.address || 'Unknown address')}</div>
      <div class="sr-sub">${esc(p.building_name || '')}</div>
      ${flags.length ? `<div class="sr-flags">${flags.join('')}</div>` : ''}
    </div>`;
  }).join('');
  els.searchResults.querySelectorAll('.search-result-item').forEach((el) => {
    el.addEventListener('click', () => selectParcel(el.dataset.id, true));
  });
}

// ---------------- Select / deselect a surveyed property ----------------
function selectParcel(id, flyTo) {
  const feature = parcelsById[id];
  if (!feature) return;
  if (selectedId !== null) map.setFeatureState({ source: 'parcels-poly', id: selectedId }, { selected: false });
  selectedId = id;
  map.setFeatureState({ source: 'parcels-poly', id }, { selected: true });

  els.emptyState.classList.add('hidden');
  els.snapshot.classList.remove('hidden');
  els.searchResults.innerHTML = '';
  renderSnapshot(feature);
  sheetExpandFn?.();

  if (flyTo) map.fitBounds(boundsOfGeometry(feature.geometry), { padding: framingPadding(), maxZoom: 17, duration: 900 });

  const url = new URL(window.location.href);
  url.searchParams.set('p', id);
  window.history.replaceState({}, '', url);
}

function deselectParcel() {
  if (selectedId !== null) map.setFeatureState({ source: 'parcels-poly', id: selectedId }, { selected: false });
  selectedId = null;
  els.snapshot.classList.add('hidden');
  els.emptyState.classList.remove('hidden');
  sheetCollapseFn?.();
  const url = new URL(window.location.href);
  url.searchParams.delete('p');
  window.history.replaceState({}, '', url);
}

// ---------------- Snapshot rendering ----------------
function statusRow(rowId, isYes, valueText) {
  const row = document.getElementById(rowId);
  row.classList.toggle('is-yes', isYes);
  row.classList.toggle('is-no', !isYes);
  document.getElementById(rowId + '-value').textContent = valueText;
}

function renderSnapshot(feature) {
  const p = feature.properties;
  els.snapAddress.textContent = p.address || 'Address unavailable';
  els.snapBuildingName.textContent = p.building_name || '';
  els.snapBuildingName.style.display = p.building_name ? '' : 'none';

  statusRow('status-tif', p.tif === 'Y', p.tif === 'Y' ? (p.tif_district || 'Yes — district name not on file') : 'Not in a TIF district');
  statusRow('status-oz', p.oz === 'Y', p.oz === 'Y' ? 'Yes — Qualified Opportunity Zone' : 'Not in an Opportunity Zone');
  statusRow('status-rerz', p.rerz === 'Y', p.rerz === 'Y' ? 'Yes — River Edge Redevelopment Zone' : 'Not in the RERZ');

  const facts = [
    ['Original Industry', p.original_industry], ['Later Industries', p.later_industries],
    ['Year Built', p.year_built], ['Additions', p.year_built_additions],
    ['Architect', p.architect], ['Contractor', p.contractor],
    ['Building Sq Ft', p.building_sqft], ['Land Sq Ft', p.land_sqft],
    ['Stories', p.stories], ['Structural System', p.structural_system],
    ['Style / Detail', p.style], ['Survey Status', p.resource_status],
    ['Significance Criteria', p.historic_criteria], ['Geographic Quadrant', p.quadrant],
    ['Current Owner', p.current_owner], ['Current Tenant(s)', p.current_tenants],
    ['Parcel PIN', p.pin],
  ];
  els.snapFacts.innerHTML = facts
    .filter(([, v]) => fmtNum(v))
    .map(([label, v]) => `<div class="snap-fact"><dt>${esc(label)}</dt><dd>${esc(v)}</dd></div>`)
    .join('');

  if (p.notes) { els.snapNotesWrap.classList.remove('hidden'); els.snapNotes.textContent = p.notes; }
  else els.snapNotesWrap.classList.add('hidden');
}

// ---------------- Share / copy ----------------
function currentShareUrl() {
  const url = new URL(CONFIG.SHARE_BASE_URL);
  if (selectedId) url.searchParams.set('p', selectedId);
  if (state.year !== CONFIG.DEFAULT_YEAR) url.searchParams.set('y', state.year);
  if (Math.abs(state.opacity - CONFIG.DEFAULT_OPACITY) >= 0.005) url.searchParams.set('o', String(Math.round(state.opacity * 100)));
  return url.toString();
}
function showToast() {
  els.snapToast.classList.add('show');
  setTimeout(() => els.snapToast.classList.remove('show'), 1800);
}
function copyShareLink() {
  if (!selectedId) return;
  const url = currentShareUrl();
  navigator.clipboard?.writeText(url).then(showToast).catch(() => {
    const tmp = document.createElement('input');
    document.body.appendChild(tmp);
    tmp.value = url; tmp.select();
    document.execCommand('copy');
    document.body.removeChild(tmp);
    showToast();
  });
}
function shareParcel() {
  if (!selectedId) return;
  const title = `${parcelsById[selectedId].properties.address} — Rockford Sanborn Fire Insurance Maps`;
  const url = currentShareUrl();
  if (navigator.share) navigator.share({ title, url }).catch(() => {});
  else copyShareLink();
}

// ---------------- Deep linking ----------------
function checkDeepLink() {
  const id = new URLSearchParams(window.location.search).get('p');
  if (id && parcelsById[id]) selectParcel(id, true);
}
