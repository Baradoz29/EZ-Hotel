/* ── Room detail page ──────────────────────────────────────────────────────── */

const roomId  = parseInt(location.pathname.split('/').pop());
const params  = new URLSearchParams(location.search);
const checkIn  = params.get('in')  || null;
const checkOut = params.get('out') || null;
const numGuests = parseInt(params.get('guests') || '2');

const PHOTO_CATS = [
  { id: 'chambre',       label: 'Chambre',        icon: '🛏️' },
  { id: 'salle_de_bain', label: 'Salle de bain',  icon: '🚿' },
  { id: 'salon',         label: 'Salon & Séjour', icon: '🛋️' },
  { id: 'vue',           label: 'Vue & Jardin',   icon: '🌿' },
  { id: 'equipements',   label: 'Équipements',    icon: '✨' },
  { id: 'general',       label: 'Galerie',        icon: '📷' },
];

const fmt = iso => iso
  ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
  : '';

function nights(ci, co) {
  return Math.ceil((new Date(co) - new Date(ci)) / 86400000);
}

/* ── Lightbox ────────────────────────────────────────────────────────────────*/
let _lbPhotos = [];
let _lbIdx    = 0;

function openLightbox(photos, idx) {
  _lbPhotos = photos;
  _lbIdx    = idx;
  renderLb();
  document.getElementById('ch-lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  document.getElementById('ch-lightbox').hidden = true;
  document.body.style.overflow = '';
}
function lbNav(dir) {
  _lbIdx = (_lbIdx + dir + _lbPhotos.length) % _lbPhotos.length;
  renderLb();
}
function renderLb() {
  document.getElementById('ch-lb-img').src = _lbPhotos[_lbIdx];
  document.getElementById('ch-lb-counter').textContent = `${_lbIdx + 1} / ${_lbPhotos.length}`;
}
document.addEventListener('keydown', e => {
  if (document.getElementById('ch-lightbox').hidden) return;
  if (e.key === 'ArrowRight') lbNav(+1);
  if (e.key === 'ArrowLeft')  lbNav(-1);
  if (e.key === 'Escape')     closeLightbox();
});
document.getElementById('ch-lightbox').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeLightbox();
});

/* ── Hero carousel ───────────────────────────────────────────────────────────*/
function buildHero(photos) {
  const hero = document.getElementById('ch-hero');
  if (!photos.length) return; // keep placeholder

  if (photos.length === 1) {
    hero.innerHTML = `<img src="${photos[0]}" alt="" class="ch-hero-img" onclick="openLightbox(${JSON.stringify(photos)},0)">`;
    return;
  }

  const imgs = photos.map((url, i) =>
    `<img src="${url}" alt="" class="ch-hero-img carousel-img${i===0?' active':''}" data-idx="${i}" onclick="openLightbox(${JSON.stringify(photos)},${i})">`
  ).join('');
  const dots = photos.map((_, i) =>
    `<span class="carousel-dot${i===0?' active':''}" data-idx="${i}"></span>`
  ).join('');

  hero.innerHTML = `
    ${imgs}
    <button class="carousel-btn carousel-prev" onclick="heroNav(-1)">&#8249;</button>
    <button class="carousel-btn carousel-next" onclick="heroNav(+1)">&#8250;</button>
    <div class="carousel-dots">${dots}</div>
    <div class="ch-hero-count">${photos.length} photos</div>`;

  hero.dataset.current = '0';
  hero.dataset.len     = photos.length;
}

let _heroInterval = null;
function heroNav(dir) {
  const hero = document.getElementById('ch-hero');
  const len  = parseInt(hero.dataset.len || '1');
  let cur    = parseInt(hero.dataset.current || '0');
  cur = (cur + dir + len) % len;
  hero.dataset.current = cur;
  hero.querySelectorAll('.ch-hero-img').forEach((img, i) => img.classList.toggle('active', i === cur));
  hero.querySelectorAll('.carousel-dot').forEach((d, i) => d.classList.toggle('active', i === cur));
}

/* ── Gallery sections ────────────────────────────────────────────────────────*/
function buildGalleries(photos) {
  const container = document.getElementById('ch-galleries');
  container.innerHTML = '';

  PHOTO_CATS.forEach(cat => {
    if (cat.id === 'chambre') return; // already in hero
    const catPhotos = photos
      .filter(p => (p.category || 'general') === cat.id)
      .map(p => `/assets/images/rooms/${roomId}/${p.filename}`);
    if (!catPhotos.length) return;

    const sec = document.createElement('div');
    sec.className = 'ch-gallery-section';
    sec.innerHTML = `
      <h2 class="ch-gallery-title">${cat.icon} ${cat.label}</h2>
      <div class="ch-gallery-grid">
        ${catPhotos.map((url, i) =>
          `<div class="ch-gallery-item" onclick="openLightbox(${JSON.stringify(catPhotos)},${i})">
            <img src="${url}" alt="" loading="lazy">
          </div>`
        ).join('')}
      </div>`;
    container.appendChild(sec);
  });
}

/* ── Sidebar booking ─────────────────────────────────────────────────────────*/
function buildSidebar(room) {
  document.getElementById('ch-price').textContent = `${room.price_per_night} € / nuit`;

  if (checkIn && checkOut) {
    const n = nights(checkIn, checkOut);
    const total = n * room.price_per_night;

    document.getElementById('ch-sum-dates').textContent  = `${fmt(checkIn)} → ${fmt(checkOut)}`;
    document.getElementById('ch-sum-nights').textContent = `${n} nuit${n > 1 ? 's' : ''}`;
    document.getElementById('ch-sum-total').textContent  = `Total : ${total.toFixed(0)} €`;
    document.getElementById('ch-summary').hidden = false;

    document.getElementById('ch-room-id').value = room.id;
    document.getElementById('ch-guests').value  = Math.min(numGuests, room.capacity);
    document.getElementById('ch-form').hidden   = false;
    document.getElementById('ch-avail-btn').hidden = true;
  }
}

/* ── Booking form submit → checkout ──────────────────────────────────────────*/
document.getElementById('ch-form').onsubmit = e => {
  e.preventDefault();
  const roomEl = document.getElementById('ch-title');
  const payload = {
    room_id:      parseInt(document.getElementById('ch-room-id').value),
    room_name:    roomEl ? roomEl.textContent : '',
    price_per_night: _roomData ? _roomData.price_per_night : 0,
    check_in:     checkIn,
    check_out:    checkOut,
    nights:       nights(checkIn, checkOut),
    num_guests:   parseInt(document.getElementById('ch-guests').value),
    guest_name:   document.getElementById('ch-name').value,
    guest_email:  document.getElementById('ch-email').value,
    guest_phone:  document.getElementById('ch-phone').value,
    notes:        document.getElementById('ch-notes').value,
  };
  sessionStorage.setItem('gk_checkout', JSON.stringify(payload));
  window.location.href = '/checkout';
};

/* ── Init ────────────────────────────────────────────────────────────────────*/
let _roomData = null;

async function init() {
  let room;
  try {
    const res = await fetch(`/api/rooms/${roomId}`);
    if (!res.ok) throw new Error('Chambre introuvable');
    room = await res.json();
  } catch {
    document.getElementById('ch-title').textContent = 'Chambre introuvable';
    return;
  }
  _roomData = room;

  // Page title
  const label = room.name || `Chambre ${room.room_number}`;
  document.getElementById('ch-page-title').textContent = `${label} — Hôtel Ginkgo`;
  document.getElementById('ch-title').textContent = label;

  // Category badge
  if (room.roomCategory) {
    try {
      const nameObj = JSON.parse(room.roomCategory.name);
      document.getElementById('ch-type').textContent = nameObj.fr || room.type;
    } catch { document.getElementById('ch-type').textContent = room.type; }
  } else {
    document.getElementById('ch-type').textContent = room.type;
  }

  // Description from category
  if (room.roomCategory?.description) {
    try {
      const descObj = JSON.parse(room.roomCategory.description);
      document.getElementById('ch-desc').textContent = descObj.fr || '';
    } catch { document.getElementById('ch-desc').textContent = room.roomCategory.description || ''; }
  }

  // Amenities
  const amenities = (room.amenities || '').split(',').map(a => a.trim()).filter(Boolean);
  document.getElementById('ch-amenities').innerHTML = amenities
    .map(a => `<span class="amenity-tag">${a}</span>`)
    .join('');

  // Hero: chambre photos first, then all photos if empty
  const chambrePhotos = room.photos
    .filter(p => (p.category || 'general') === 'chambre')
    .map(p => `/assets/images/rooms/${roomId}/${p.filename}`);
  const allPhotos = room.photos.map(p => `/assets/images/rooms/${roomId}/${p.filename}`);
  buildHero(chambrePhotos.length ? chambrePhotos : allPhotos);

  // Gallery sections
  buildGalleries(room.photos);

  // Sidebar
  buildSidebar(room);

  // Auto-rotate hero
  if (parseInt(document.getElementById('ch-hero').dataset.len || '0') > 1) {
    setInterval(() => heroNav(+1), 4500);
  }
}

init();
