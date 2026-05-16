/* ── State ─────────────────────────────────────────────────────────────────── */
const state = {
  checkIn:   null,
  checkOut:  null,
  hoverDate: null,   // hover preview, never saved as confirmed selection
  guests:    2,
  picking:   'start',   // 'start' | 'end'
  viewYear:  new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
};

/* ── Helpers ───────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const fmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString(t('locale'), { day: 'numeric', month: 'short' }) : null;
const today = new Date(); today.setHours(0, 0, 0, 0);
const toISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

/* ── Effective end for range display (hover preview during end selection) ─── */
function effectiveEnd() {
  if (state.picking === 'end' && state.hoverDate && state.hoverDate > state.checkIn)
    return state.hoverDate;
  return state.checkOut;
}

/* ── Build picker DOM (called once per open or month change) ─────────────── */
function renderPicker() {
  const container = $('dp-months');
  container.innerHTML = '';
  for (let offset = 0; offset < 2; offset++) {
    let m = state.viewMonth + offset;
    let y = state.viewYear;
    if (m > 11) { m -= 12; y += 1; }
    container.appendChild(buildMonth(y, m));
  }
  updateSelLabel();
}

function buildMonth(year, month) {
  const wrap = document.createElement('div');
  wrap.className = 'dp-month';
  const title = new Date(year, month, 1).toLocaleDateString(t('locale'), { month: 'long', year: 'numeric' });

  wrap.innerHTML = `
    <div class="dp-month-header">
      <button class="dp-prev">‹</button>
      <span class="dp-month-title">${title}</span>
      <button class="dp-next">›</button>
    </div>
    <div class="dp-weekdays">
      ${t('dp.weekdays').map(d => `<div class="dp-weekday">${d}</div>`).join('')}
    </div>
    <div class="dp-days"></div>`;

  wrap.querySelector('.dp-prev').onclick = e => { e.stopPropagation(); prevMonth(); renderPicker(); };
  wrap.querySelector('.dp-next').onclick = e => { e.stopPropagation(); nextMonth(); renderPicker(); };

  const daysDiv = wrap.querySelector('.dp-days');
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon = 0

  for (let i = 0; i < firstDow; i++) {
    const el = document.createElement('div');
    el.className = 'dp-day dp-empty';
    daysDiv.appendChild(el);
  }

  const end = getEffectiveEnd();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const iso  = toISO(date);
    const el   = document.createElement('div');
    el.className = 'dp-day';
    el.textContent = d;
    el.dataset.iso = iso;

    const isPast  = date < today;
    if (isPast) {
      el.classList.add('dp-past');
    } else {
      applyRangeClass(el, iso, end);
      el.addEventListener('click', () => onDayClick(iso));
      el.addEventListener('mouseenter', () => onDayHover(iso));
    }
    daysDiv.appendChild(el);
  }
  return wrap;
}

/* Apply start/end/range classes to a single element */
function applyRangeClass(el, iso, end) {
  el.classList.toggle('dp-start', iso === state.checkIn);
  el.classList.toggle('dp-end',   iso === end && iso !== state.checkIn);
  el.classList.toggle('dp-range', !!(state.checkIn && end && iso > state.checkIn && iso < end));
}

/* ── Hover: update classes in-place WITHOUT re-rendering DOM ────────────── */
function onDayHover(iso) {
  if (state.picking !== 'end' || !state.checkIn) return;
  state.hoverDate = iso;
  const end = getEffectiveEnd();
  document.querySelectorAll('.dp-day[data-iso]').forEach(el => applyRangeClass(el, el.dataset.iso, end));
}

function getEffectiveEnd() {
  if (state.picking === 'end' && state.hoverDate && state.hoverDate > state.checkIn)
    return state.hoverDate;
  return state.checkOut;
}

/* ── Click ───────────────────────────────────────────────────────────────── */
function onDayClick(iso) {
  if (state.picking === 'start') {
    state.checkIn  = iso;
    state.checkOut = null;
    state.hoverDate = null;
    state.picking  = 'end';
    renderPicker();
  } else {
    if (iso <= state.checkIn) {
      // Clicked before/on start → restart selection from this date
      state.checkIn  = iso;
      state.checkOut = null;
      state.hoverDate = null;
      renderPicker();
    } else {
      state.checkOut  = iso;
      state.hoverDate = null;
      state.picking   = 'start';
      renderPicker();
      closePicker();
    }
  }
  updateDatesLabel();
  updateSelLabel();
}

/* ── Navigation ──────────────────────────────────────────────────────────── */
function prevMonth() {
  state.viewMonth--;
  if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
}
function nextMonth() {
  state.viewMonth++;
  if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
}

/* ── Labels ──────────────────────────────────────────────────────────────── */
function updateSelLabel() {
  $('dp-selection-label').textContent =
    state.picking === 'start' ? t('dp.select.arrival') : t('dp.select.departure');
}

function updateDatesLabel() {
  const ci = fmt(state.checkIn), co = fmt(state.checkOut);
  $('sb-dates-label').textContent =
    ci && co ? `${ci}  →  ${co}` :
    ci       ? `${ci}  →  ?` :
               t('sb.dates.placeholder');
}

/* ── Open / Close ────────────────────────────────────────────────────────── */
function openPicker() {
  state.hoverDate = null;
  $('date-picker').hidden = false;
  renderPicker();
}
function closePicker() {
  state.hoverDate = null;
  $('date-picker').hidden = true;
}

/* ── Guests ──────────────────────────────────────────────────────────────── */
$('guests-minus').onclick = () => { if (state.guests > 1) { state.guests--; $('guests-count').textContent = state.guests; } };
$('guests-plus').onclick  = () => { if (state.guests < 8) { state.guests++; $('guests-count').textContent = state.guests; } };

/* ── Picker toggle ───────────────────────────────────────────────────────── */
$('sb-dates-trigger').onclick = e => {
  e.stopPropagation();
  $('date-picker').hidden ? openPicker() : closePicker();
};

$('dp-clear').onclick = e => {
  e.stopPropagation();
  state.checkIn = state.checkOut = state.hoverDate = null;
  state.picking = 'start';
  updateDatesLabel();
  renderPicker();
};

// Close when clicking outside
document.addEventListener('click', e => {
  const dp   = $('date-picker');
  const wrap = document.querySelector('.search-bar-wrap');
  if (!dp.hidden && !wrap.contains(e.target)) closePicker();
});

// Reset hover when mouse leaves the calendar
$('dp-months').addEventListener('mouseleave', () => {
  if (state.picking !== 'end') return;
  state.hoverDate = null;
  const end = state.checkOut;
  document.querySelectorAll('.dp-day[data-iso]').forEach(el => applyRangeClass(el, el.dataset.iso, end));
});

/* ── Search ──────────────────────────────────────────────────────────────── */
$('search-btn').onclick = async () => {
  if (!state.checkIn || !state.checkOut) {
    openPicker();
    $('dp-selection-label').textContent = t('dp.warn');
    return;
  }
  await searchRooms();
};

let _lastResults = null;
let _groups      = [];

async function searchRooms() {
  const btn = $('search-btn');
  btn.textContent = '…';
  btn.disabled = true;
  try {
    const res   = await fetch(`/api/availability?check_in=${state.checkIn}&check_out=${state.checkOut}&guests=${state.guests}`);
    _lastResults = await res.json();
    displayResults(_lastResults);
  } catch {
    alert('Erreur de connexion. Veuillez réessayer.');
  } finally {
    btn.innerHTML = t('sb.search');
    btn.disabled = false;
  }
}

/* ── Results ─────────────────────────────────────────────────────────────── */
function displayResults(rooms) {
  const section = $('results-section');
  const n = Math.ceil((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);
  const groups = groupByType(rooms);
  _groups = groups;

  $('results-title').textContent = groups.length > 0
    ? t('results.types', groups.length)
    : t('results.none');
  $('results-sub').textContent = t('results.sub', fmt(state.checkIn), fmt(state.checkOut), n, state.guests);

  $('rooms-grid').innerHTML = groups.length === 0
    ? `<p style="color:var(--muted);grid-column:1/-1">${t('results.empty')}</p>`
    : groups.map(g => typeCardHTML(g, n, true)).join('');

  $('rooms-section').hidden = true;
  section.hidden = false;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── Room Type Cards ─────────────────────────────────────────────────────── */
let _categories = [];

function getCategoryName(slug) {
  const cat = _categories.find(c => c.slug === slug);
  return cat ? (getLocalDesc(cat.name) || slug) : slug;
}
function getCategoryDesc(slug) {
  const cat = _categories.find(c => c.slug === slug);
  return cat ? getLocalDesc(cat.description) : '';
}

function groupByType(rooms) {
  const map = {};
  rooms.forEach(r => {
    if (!map[r.type]) {
      map[r.type] = { ...r, rooms: [r], minPrice: r.price_per_night, maxPrice: r.price_per_night };
    } else {
      map[r.type].rooms.push(r);
      map[r.type].minPrice = Math.min(map[r.type].minPrice, r.price_per_night);
      map[r.type].maxPrice = Math.max(map[r.type].maxPrice, r.price_per_night);
    }
  });
  const groups = Object.values(map);
  groups.forEach(g => {
    const amenSet = new Set();
    g.rooms.forEach(r => {
      (r.amenities || '').split(',').forEach(a => { const t = a.trim(); if (t) amenSet.add(t); });
    });
    g.amenities = [...amenSet].join(',');
    g.photos = g.rooms.flatMap(r => (r.photos || []).map(p => `/assets/images/rooms/${r.id}/${p.filename}`));
  });
  const catOrder = {};
  _categories.forEach(c => { catOrder[c.slug] = c.sort_order ?? 999; });
  groups.sort((a, b) => ((catOrder[a.type] ?? 999) - (catOrder[b.type] ?? 999)) || a.type.localeCompare(b.type));
  return groups;
}

function getLocalDesc(raw) {
  if (!raw) return '';
  try {
    const p = JSON.parse(raw);
    if (typeof p === 'object' && p !== null)
      return p[_lang] || p.fr || Object.values(p).find(Boolean) || '';
  } catch(e) {}
  return raw;
}

function toggleAmenities(btn) {
  const extra = btn.previousElementSibling;
  const open = !extra.hidden;
  extra.hidden = open;
  btn.textContent = open
    ? btn.textContent.replace('▴', '▾')
    : btn.textContent.replace('▾', '▴');
}

function carouselHTML(photos, countBadge) {
  if (photos.length === 1) {
    return `<div class="room-card-img room-card-carousel">
      <img src="${photos[0]}" alt="" class="carousel-img active">
      ${countBadge}
    </div>`;
  }
  const imgs = photos.map((url, i) => `<img src="${url}" alt="" class="carousel-img${i===0?' active':''}">`).join('');
  const dots = photos.map((_, i) => `<span class="carousel-dot${i===0?' active':''}" data-idx="${i}"></span>`).join('');
  return `<div class="room-card-img room-card-carousel" data-carousel data-current="0" data-len="${photos.length}">
    ${imgs}
    <button class="carousel-btn carousel-prev">&#8249;</button>
    <button class="carousel-btn carousel-next">&#8250;</button>
    <div class="carousel-dots">${dots}</div>
    ${countBadge}
  </div>`;
}

function typeCardHTML(group, nights = null, bookable = false) {
  const amenityList = (group.amenities || '').split(',').map(a => a.trim()).filter(Boolean);
  const VISIBLE = 4;
  const visibleTags = amenityList.slice(0, VISIBLE).map(a => `<span class="amenity-tag">${a}</span>`).join('');
  const extra = amenityList.slice(VISIBLE);
  const hiddenPart = extra.length
    ? `<span class="amenity-extra" hidden>${extra.map(a => `<span class="amenity-tag">${a}</span>`).join('')}</span><button class="amenity-more-btn" onclick="toggleAmenities(this)">+${extra.length} autres ▾</button>`
    : '';
  const amenities = visibleTags + hiddenPart;

  const priceStr = group.minPrice === group.maxPrice
    ? `${group.minPrice} €`
    : `${group.minPrice} – ${group.maxPrice} €`;

  const totalStr = nights
    ? `<br><small>${t('room.total')} ${(nights * group.minPrice).toFixed(0)}${group.minPrice !== group.maxPrice ? ' – ' + (nights * group.maxPrice).toFixed(0) : ''} €</small>`
    : '';

  const countBadge = bookable && group.rooms.length > 1
    ? `<span class="avail-badge">${t('room.avail.many', group.rooms.length)}</span>`
    : bookable
    ? `<span class="avail-badge">${t('room.avail.one')}</span>`
    : '';

  const btn = bookable
    ? `<button class="btn-book" onclick="openCategoryBooking('${group.type}')">${t('room.book')}</button>`
    : `<button class="btn-book unavailable" onclick="openPicker()">${t('room.choose_dates')}</button>`;

  const imgSection = group.photos && group.photos.length > 0
    ? carouselHTML(group.photos, countBadge)
    : `<div class="room-card-img type-${group.type}">🛏️${countBadge}</div>`;

  return `
    <div class="room-card">
      ${imgSection}
      <div class="room-card-body">
        <div class="room-card-type">${getCategoryName(group.type)}</div>
        <div class="room-card-name">${group.name}</div>
        <div class="room-card-desc">${getCategoryDesc(group.type)}</div>
        <div class="room-card-amenities">${amenities}</div>
        <div class="room-card-footer">
          <div>
            <div class="room-price">${priceStr} <span>${t('room.per_night')}</span></div>
            <div class="room-meta">👤 ${t('room.max')} ${group.capacity} ${t('room.pers')} ${totalStr}</div>
          </div>
          ${btn}
        </div>
      </div>
    </div>`;
}

/* ── Feuilles de ginkgo animées ──────────────────────────────────────────── */
(function initLeaves() {
  const hero    = document.querySelector('.hero');
  const content = hero.querySelector('.hero-content');
  const layer   = document.createElement('div');
  layer.className = 'leaves-layer';
  hero.insertBefore(layer, content);

  const STEPS  = 20;   // échantillons de la sinusoïde
  const HEIGHT = 660;  // distance de chute en px
  // La feuille SVG est dessinée à 45° (tige bas-gauche, lame haut-droit).
  // baseRot positionne chaque feuille dans une orientation de départ variée.
  // tiltAmp contrôle l'amplitude de balancement angulaire.
  // La lame (large, prise au vent) résiste → rotation amortie côté lame.
  // La tige (légère, peu de prise) s'oriente vers le haut lors des pics.

  for (let i = 0; i < 18; i++) {
    const size    = 40 + Math.random() * 50;           // 40–90 px
    const left    = Math.random() * 106 - 3;
    const dur     = 11 + Math.random() * 10;           // 11–21 s
    const del     = -(Math.random() * dur);
    const amp     = 40 + Math.random() * 50;           // amplitude balancement horizontal
    const freq    = 0.35 + Math.random() * 0.4;        // 0.35–0.75 cycles → brise lente
    const phase   = Math.random() * Math.PI * 2;
    const op      = (0.45 + Math.random() * 0.4).toFixed(2);

    // Orientation de base : large dispersion tenant compte du 45° SVG
    // −45° = tige en haut (léger) · +135° = lame en bas (lourd, position naturelle)
    const baseRot = -45 + Math.random() * 180;         // −45° à +135°

    // Amplitude angulaire : large pour varier les postures en chute libre
    const tiltAmp = 30 + Math.random() * 40;           // 30°–70°

    // Asymétrie physique : la lame freine la rotation côté "lourd"
    // → quand la feuille part vers un côté, elle résiste légèrement au retour
    const dragBias = (Math.random() * 12 - 6);         // décalage léger du centre d'oscillation

    // Génère une @keyframes unique avec X et R en sinusoïde continue
    const name = `gl${i}`;
    let kf = `@keyframes ${name}{`;
    for (let s = 0; s <= STEPS; s++) {
      const t   = s / STEPS;
      const pct = (t * 100).toFixed(1);
      const y   = (HEIGHT * t).toFixed(1);
      const x   = (amp * Math.sin(2 * Math.PI * freq * t + phase)).toFixed(2);
      // Rotation = baseRot + oscillation (dérivée de sin = cos, représente l'effet du vent)
      // dragBias décale légèrement le centre → simule la résistance de la lame
      const r   = (baseRot + dragBias + tiltAmp * Math.cos(2 * Math.PI * freq * t + phase)).toFixed(2);
      const fadein   = s === 1          ? `opacity:${op};` : '';
      const fadeout  = s === STEPS - 1  ? `opacity:${op};` : '';
      const fadeend  = s === STEPS      ? 'opacity:0;'     : '';
      const fadezero = s === 0          ? 'opacity:0;'     : '';
      kf += `${pct}%{transform:translateY(${y}px) translateX(${x}px) rotate(${r}deg);${fadezero}${fadein}${fadeout}${fadeend}}`;
    }
    kf += '}';

    const style = document.createElement('style');
    style.textContent = kf;
    document.head.appendChild(style);

    const leaf = document.createElement('img');
    leaf.className = 'ginkgo-leaf';
    leaf.src = '/assets/icons/favicon.svg';
    leaf.setAttribute('aria-hidden', 'true');
    leaf.style.cssText = `width:${size}px;height:${size}px;left:${left}%;animation-name:${name};animation-duration:${dur}s;animation-delay:${del}s;`;
    layer.appendChild(leaf);
  }
})();

/* ── Showcase (page load) ────────────────────────────────────────────────── */
async function loadShowcase() {
  const [rooms, cats] = await Promise.all([
    fetch('/api/rooms').then(r => r.json()),
    fetch('/api/categories').then(r => r.json())
  ]);
  _categories = cats;
  $('showcase-grid').innerHTML = groupByType(rooms).map(g => typeCardHTML(g)).join('');
}
loadShowcase();

/* ── Booking Modal ───────────────────────────────────────────────────────── */
let currentRoom = null;

function openCategoryBooking(type) {
  if (!state.checkIn || !state.checkOut) { openPicker(); return; }
  const group = _groups.find(g => g.type === type);
  if (!group) return;

  const n = Math.ceil((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);
  $('modal-category-name').textContent = getCategoryName(type);
  $('modal-step1-summary').innerHTML = t('modal.summary', fmt(state.checkIn), fmt(state.checkOut), n, state.guests);

  const list = $('room-picker-list');
  list.innerHTML = '';

  const sorted = [...group.rooms].sort((a, b) => a.price_per_night - b.price_per_night);
  const best = sorted[0];
  const roomLabel = r => r.name || `Chambre ${r.room_number}`;

  const previewUrl = room => `/chambre/${room.id}?in=${state.checkIn || ''}&out=${state.checkOut || ''}&guests=${state.guests}`;

  const bestCard = document.createElement('div');
  bestCard.className = 'room-pick-card room-pick-best';
  bestCard.innerHTML = `
    <div class="room-pick-star">⭐</div>
    <div class="room-pick-info">
      <div class="room-pick-label">Meilleure disponibilité</div>
      <div class="room-pick-name">${roomLabel(best)}</div>
      <div class="room-pick-price">${best.price_per_night} € <span>/ nuit · total ${(n * best.price_per_night).toFixed(0)} €</span></div>
    </div>
    <div class="room-pick-actions">
      <a class="btn-preview" href="${previewUrl(best)}" target="_blank">Aperçu</a>
      <button class="btn-book" onclick="selectRoom(${best.id})">Choisir</button>
    </div>`;
  list.appendChild(bestCard);

  if (sorted.length > 1) {
    const sep = document.createElement('div');
    sep.className = 'room-pick-sep';
    sep.textContent = 'ou choisir une chambre spécifique';
    list.appendChild(sep);

    sorted.forEach(room => {
      const photos = (room.photos || []).map(p => `/assets/images/rooms/${room.id}/${p.filename}`);
      const imgHtml = photos.length > 0
        ? `<img class="room-pick-img" src="${photos[0]}" alt="">`
        : `<div class="room-pick-img-ph">🛏️</div>`;

      const card = document.createElement('div');
      card.className = 'room-pick-card';
      card.innerHTML = `
        ${imgHtml}
        <div class="room-pick-info">
          <div class="room-pick-name">${roomLabel(room)}</div>
          <div class="room-pick-meta">👤 max ${room.capacity} pers.</div>
          <div class="room-pick-price">${room.price_per_night} € <span>/ nuit · total ${(n * room.price_per_night).toFixed(0)} €</span></div>
        </div>
        <div class="room-pick-actions">
          <a class="btn-preview" href="${previewUrl(room)}" target="_blank">Aperçu</a>
          <button class="btn-book" onclick="selectRoom(${room.id})">Choisir</button>
        </div>`;
      list.appendChild(card);
    });
  }

  $('modal-step1').hidden = false;
  $('modal-step2').hidden = true;
  $('booking-modal').hidden = false;
}

function selectRoom(roomId) { openBooking(roomId); }

async function openBooking(roomId) {
  if (!state.checkIn || !state.checkOut) { openPicker(); return; }

  currentRoom = (_lastResults || []).find(r => r.id === roomId);
  if (!currentRoom) {
    const rooms = await fetch('/api/rooms').then(r => r.json());
    currentRoom = rooms.find(r => r.id === roomId);
  }
  if (!currentRoom) return;

  const n     = Math.ceil((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);
  const total = n * currentRoom.price_per_night;

  $('modal-room-name').textContent = currentRoom.name || `Chambre ${currentRoom.room_number}`;
  $('modal-summary').innerHTML = t('modal.summary', fmt(state.checkIn), fmt(state.checkOut), n, state.guests);
  $('modal-price-line').textContent = t('modal.total', total.toFixed(2));
  $('bf-room-id').value = roomId;
  $('bf-guests').value  = state.guests;
  $('modal-step1').hidden = true;
  $('modal-step2').hidden = false;
  $('booking-modal').hidden = false;
}

$('modal-close').onclick   = () => { $('booking-modal').hidden = true; };
$('modal-back').onclick    = () => { $('modal-step2').hidden = true; $('modal-step1').hidden = false; };
$('booking-modal').onclick = e => { if (e.target === $('booking-modal')) $('booking-modal').hidden = true; };

$('booking-form').onsubmit = e => {
  e.preventDefault();
  const payload = {
    room_id:      parseInt($('bf-room-id').value),
    room_name:    currentRoom ? (currentRoom.name || `Chambre ${currentRoom.room_number}`) : '',
    room_type:    currentRoom ? currentRoom.type : '',
    room_number:  currentRoom ? currentRoom.room_number : '',
    price_per_night: currentRoom ? currentRoom.price_per_night : 0,
    check_in:     state.checkIn,
    check_out:    state.checkOut,
    nights:       Math.ceil((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000),
    num_guests:   parseInt($('bf-guests').value),
    guest_name:   $('bf-name').value,
    guest_email:  $('bf-email').value,
    guest_phone:  $('bf-phone').value,
    notes:        $('bf-notes').value,
  };
  sessionStorage.setItem('gk_checkout', JSON.stringify(payload));
  window.location.href = `/checkout`;
};

function closeConfirm() { $('confirm-modal').hidden = true; }
$('confirm-close').onclick = closeConfirm;

function onLangChange() {
  updateDatesLabel();
  if (!$('date-picker').hidden) renderPicker();
  updateSelLabel();
  loadShowcase();
  if (_lastResults && !$('results-section').hidden) displayResults(_lastResults);
}

/* ── Carousel ────────────────────────────────────────────────────────────── */
function setCarouselSlide(carousel, idx) {
  carousel.dataset.current = idx;
  carousel.querySelectorAll('.carousel-img').forEach((img, i) => img.classList.toggle('active', i === idx));
  carousel.querySelectorAll('.carousel-dot').forEach((dot, i) => dot.classList.toggle('active', i === idx));
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.carousel-btn');
  if (btn) {
    e.stopPropagation();
    const carousel = btn.closest('[data-carousel]');
    if (!carousel) return;
    const len = parseInt(carousel.dataset.len);
    let cur = parseInt(carousel.dataset.current);
    cur = btn.classList.contains('carousel-next') ? (cur + 1) % len : (cur - 1 + len) % len;
    setCarouselSlide(carousel, cur);
    return;
  }
  const dot = e.target.closest('.carousel-dot');
  if (dot) {
    e.stopPropagation();
    const carousel = dot.closest('[data-carousel]');
    if (carousel) setCarouselSlide(carousel, parseInt(dot.dataset.idx));
  }
});

document.addEventListener('mouseover', e => {
  const c = e.target.closest('[data-carousel]');
  if (c) c.dataset.paused = '1';
});
document.addEventListener('mouseout', e => {
  const c = e.target.closest('[data-carousel]');
  if (c && !c.contains(e.relatedTarget)) delete c.dataset.paused;
});

setInterval(() => {
  document.querySelectorAll('[data-carousel]:not([data-paused])').forEach(carousel => {
    const len = parseInt(carousel.dataset.len);
    if (len <= 1) return;
    setCarouselSlide(carousel, (parseInt(carousel.dataset.current) + 1) % len);
  });
}, 4500);

/* ── Reviews (avis voyageurs) ────────────────────────────────────────────── */
(async function loadReviews() {
  const reviews = await fetch('/api/reviews/approved').then(r => r.json()).catch(() => []);
  if (!reviews.length) return;

  const section = document.getElementById('reviews-section');
  const track   = document.getElementById('reviews-track');
  const fmtDate = iso => new Date(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const stars   = n => '★'.repeat(n) + '☆'.repeat(5 - n);

  track.innerHTML = reviews.map(r => `
    <div class="review-card">
      <div class="review-stars">${stars(r.rating)}</div>
      <p class="review-quote">${r.comment.replace(/</g,'&lt;')}</p>
      <div>
        <div class="review-author">${r.name.replace(/</g,'&lt;')}</div>
        <div class="review-date">${fmtDate(r.created_at)}</div>
      </div>
    </div>`).join('');

  section.hidden = false;
})();
