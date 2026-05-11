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
const fmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : null;
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
  const title = new Date(year, month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  wrap.innerHTML = `
    <div class="dp-month-header">
      <button class="dp-prev">‹</button>
      <span class="dp-month-title">${title}</span>
      <button class="dp-next">›</button>
    </div>
    <div class="dp-weekdays">
      ${['Lu','Ma','Me','Je','Ve','Sa','Di'].map(d => `<div class="dp-weekday">${d}</div>`).join('')}
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
    state.picking === 'start' ? 'Sélectionnez votre arrivée' : 'Sélectionnez votre départ';
}

function updateDatesLabel() {
  const ci = fmt(state.checkIn), co = fmt(state.checkOut);
  $('sb-dates-label').textContent =
    ci && co ? `${ci}  →  ${co}` :
    ci       ? `${ci}  →  ?` :
               'Choisir les dates';
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
    $('dp-selection-label').textContent = '⚠️ Veuillez choisir vos dates';
    return;
  }
  await searchRooms();
};

async function searchRooms() {
  const btn = $('search-btn');
  btn.textContent = 'Recherche…';
  btn.disabled = true;
  try {
    const res   = await fetch(`/api/availability?check_in=${state.checkIn}&check_out=${state.checkOut}&guests=${state.guests}`);
    const rooms = await res.json();
    displayResults(rooms);
  } catch {
    alert('Erreur de connexion. Veuillez réessayer.');
  } finally {
    btn.textContent = 'Rechercher';
    btn.disabled = false;
  }
}

/* ── Results ─────────────────────────────────────────────────────────────── */
function displayResults(rooms) {
  const section = $('results-section');
  const n = Math.ceil((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);
  const groups = groupByType(rooms);

  $('results-title').textContent = groups.length > 0
    ? `${groups.length} type${groups.length > 1 ? 's' : ''} de chambre disponible${groups.length > 1 ? 's' : ''}`
    : 'Aucune disponibilité';
  $('results-sub').textContent =
    `${fmt(state.checkIn)} → ${fmt(state.checkOut)} · ${n} nuit${n > 1 ? 's' : ''} · ${state.guests} voyageur${state.guests > 1 ? 's' : ''}`;

  $('rooms-grid').innerHTML = groups.length === 0
    ? `<p style="color:var(--muted);grid-column:1/-1">Aucune chambre disponible pour ces critères. Essayez d'autres dates.</p>`
    : groups.map(g => typeCardHTML(g, n, true)).join('');

  section.hidden = false;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── Room Type Cards ─────────────────────────────────────────────────────── */
const typeEmoji = { duplex:'🏡', superieure:'🌿', prestige:'⭐', junior_suite:'✨', suite:'👑' };
const typeLabel = { duplex:'Confort en Duplex', superieure:'Chambre Supérieure', prestige:'Chambre Prestige', junior_suite:'Suite Junior', suite:'Suite Prestige' };
const TYPE_ORDER = ['duplex', 'superieure', 'prestige', 'junior_suite', 'suite'];

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
  return TYPE_ORDER.filter(t => map[t]).map(t => map[t]);
}

function typeCardHTML(group, nights = null, bookable = false) {
  const amenities = (group.amenities || '').split(',').slice(0, 4).map(a => `<span class="amenity-tag">${a.trim()}</span>`).join('');

  const priceStr = group.minPrice === group.maxPrice
    ? `${group.minPrice} €`
    : `${group.minPrice} – ${group.maxPrice} €`;

  const totalStr = nights
    ? `<br><small>Total : ${(nights * group.minPrice).toFixed(0)}${group.minPrice !== group.maxPrice ? ' – ' + (nights * group.maxPrice).toFixed(0) : ''} €</small>`
    : '';

  const countBadge = bookable && group.rooms.length > 1
    ? `<span class="avail-badge">${group.rooms.length} disponibles</span>`
    : bookable
    ? `<span class="avail-badge">1 disponible</span>`
    : '';

  const btn = bookable
    ? `<button class="btn-book" onclick="openBooking(${group.rooms[0].id})">Réserver</button>`
    : `<button class="btn-book unavailable" onclick="openPicker()">Choisir les dates</button>`;

  return `
    <div class="room-card">
      <div class="room-card-img type-${group.type}">${typeEmoji[group.type] || '🛏️'}${countBadge}</div>
      <div class="room-card-body">
        <div class="room-card-type">${typeLabel[group.type] || group.type}</div>
        <div class="room-card-name">${group.name}</div>
        <div class="room-card-desc">${group.description || ''}</div>
        <div class="room-card-amenities">${amenities}</div>
        <div class="room-card-footer">
          <div>
            <div class="room-price">${priceStr} <span>/ nuit</span></div>
            <div class="room-meta">👤 max ${group.capacity} pers. ${totalStr}</div>
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
  const rooms = await fetch('/api/rooms').then(r => r.json());
  $('showcase-grid').innerHTML = groupByType(rooms).map(g => typeCardHTML(g)).join('');
}
loadShowcase();

/* ── Booking Modal ───────────────────────────────────────────────────────── */
let currentRoom = null;

async function openBooking(roomId) {
  if (!state.checkIn || !state.checkOut) { openPicker(); return; }
  const rooms = await fetch('/api/rooms').then(r => r.json());
  currentRoom = rooms.find(r => r.id === roomId);
  if (!currentRoom) return;

  const n     = Math.ceil((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);
  const total = n * currentRoom.price_per_night;

  $('modal-room-name').textContent = currentRoom.name;
  $('modal-summary').innerHTML = `📅 ${fmt(state.checkIn)} → ${fmt(state.checkOut)} · ${n} nuit${n > 1 ? 's' : ''} · ${state.guests} voyageur${state.guests > 1 ? 's' : ''}`;
  $('modal-price-line').textContent = `Total : ${total.toFixed(2)} €`;
  $('bf-room-id').value = roomId;
  $('bf-guests').value  = state.guests;
  $('booking-modal').hidden = false;
}

$('modal-close').onclick    = () => { $('booking-modal').hidden = true; };
$('booking-modal').onclick  = e => { if (e.target === $('booking-modal')) $('booking-modal').hidden = true; };

$('booking-form').onsubmit = async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Confirmation…';

  const body = {
    room_id:     parseInt($('bf-room-id').value),
    guest_name:  $('bf-name').value,
    guest_email: $('bf-email').value,
    guest_phone: $('bf-phone').value,
    check_in:    state.checkIn,
    check_out:   state.checkOut,
    num_guests:  parseInt($('bf-guests').value),
    notes:       $('bf-notes').value,
  };

  try {
    const res  = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showConfirmation(data, body);
  } catch (err) {
    alert(`Erreur : ${err.message}`);
    btn.disabled = false; btn.textContent = 'Confirmer la réservation';
  }
};

function showConfirmation(data, body) {
  $('booking-modal').hidden = true;
  const n = data.nights;
  $('confirm-details').innerHTML = `
    <p><strong>Réservation N° ${data.id}</strong></p>
    <p>${currentRoom.name}</p>
    <p>${fmt(body.check_in)} → ${fmt(body.check_out)} · ${n} nuit${n > 1 ? 's' : ''}</p>
    <p>Nom : ${body.guest_name}</p>
    <p>Email : ${body.guest_email}</p>
    <p><strong>Total : ${data.total_price.toFixed(2)} €</strong></p>
    <p style="margin-top:12px;font-size:.8rem">Un récapitulatif vous sera envoyé par email.</p>`;
  $('confirm-modal').hidden = false;
}

function closeConfirm() { $('confirm-modal').hidden = true; }
