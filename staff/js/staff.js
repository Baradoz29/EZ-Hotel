/* ── Helpers ───────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const api = async (url, opts = {}) => {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Erreur serveur');
  }
  return res.json();
};
const fmtDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const nights  = (ci, co) => Math.ceil((new Date(co) - new Date(ci)) / 86400000);
const statusBadge = s => `<span class="badge badge-${s}">${{ confirmed:'Confirmée', pending:'En attente', cancelled:'Annulée' }[s] || s}</span>`;
const sourceBadge = s => `<span class="badge badge-${s||'staff'}">${s === 'website' ? 'Site web' : 'Réception'}</span>`;
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ── Login ─────────────────────────────────────────────────────────────────── */
$('login-form').onsubmit = async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.textContent = 'Connexion…'; btn.disabled = true;
  try {
    const data = await api('/api/staff/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('lf-user').value, password: $('lf-pass').value })
    });
    enterApp(data);
  } catch (err) {
    $('lf-error').textContent = err.message;
    $('lf-error').hidden = false;
    btn.textContent = 'Se connecter'; btn.disabled = false;
  }
};

function enterApp(user) {
  $('login-screen').hidden = true;
  $('app-shell').hidden = false;
  $('sf-name').textContent  = user.name;
  $('sf-role').textContent  = user.role === 'admin' ? 'Admin' : 'Réception';
  $('dash-date').textContent = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  switchView('dashboard');
}

// Auto-login check on page load
api('/api/staff/me').then(enterApp).catch(() => {});

/* ── Logout ────────────────────────────────────────────────────────────────── */
$('logout-btn').onclick = async () => {
  await api('/api/staff/logout', { method: 'POST' });
  $('app-shell').hidden = true;
  $('login-screen').hidden = false;
  $('lf-pass').value = '';
};

/* ── Navigation ────────────────────────────────────────────────────────────── */
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.hidden = true);
  document.querySelectorAll('.snav-item').forEach(a => a.classList.remove('active'));
  $(`view-${name}`).hidden = false;
  const link = document.querySelector(`[data-view="${name}"]`);
  if (link) link.classList.add('active');

  if (name === 'dashboard')        loadDashboard();
  if (name === 'reservations')     loadReservations();
  if (name === 'occupancy')        initOccupancy();
  if (name === 'rooms')            loadRooms();
  if (name === 'new-reservation')  initReservationForm(null);
  if (name === 'housekeeping')     initHousekeeping();
  if (name === 'planning')         initPlanning();
  if (name === 'personnel')        loadPersonnel();
}

document.querySelectorAll('.snav-item').forEach(a => {
  a.onclick = () => switchView(a.dataset.view);
});

/* ── Dashboard ─────────────────────────────────────────────────────────────── */
async function loadDashboard() {
  const stats = await api('/api/staff/stats');
  $('stat-arrivals').textContent   = stats.arrivals_today;
  $('stat-departures').textContent = stats.departures_today;
  $('stat-occupied').textContent   = `${stats.occupied_tonight} / ${stats.total_rooms}`;
  $('stat-pending').textContent    = stats.pending;
  $('stat-revenue').textContent    = `${Number(stats.revenue_month).toLocaleString('fr-FR')} €`;

  const today = todayISO();
  const [arrivals, departures] = await Promise.all([
    api(`/api/staff/reservations?from=${today}&to=${today}&status=confirmed`),
    api(`/api/staff/reservations?from=${today}&to=${today}&status=confirmed`),
  ]);
  const arr = arrivals.filter(r => r.check_in  === today);
  const dep = departures.filter(r => r.check_out === today);

  renderMiniTable('arrivals-tbody',   arr,  'check_out');
  renderMiniTable('departures-tbody', dep,  'check_in');
}

function renderMiniTable(tbodyId, rows, otherDateKey) {
  const tbody = $(tbodyId);
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:16px">Aucun enregistrement</td></tr>`; return; }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>#${r.id}</td>
      <td><strong>${r.guest_name}</strong></td>
      <td>${r.room_number ? r.room_number + ' – ' : ''}${r.room_name}</td>
      <td>${fmtDate(r[otherDateKey])}</td>
      <td>${r.num_guests}</td>
      <td>${statusBadge(r.status)}</td>
      <td><button class="btn-detail" onclick="openDetail(${r.id})">Détails</button></td>
    </tr>`).join('');
}

/* ── Reservations List ─────────────────────────────────────────────────────── */
async function loadReservations() {
  const search = $('filter-search').value;
  const from   = $('filter-from').value;
  const to     = $('filter-to').value;
  const status = $('filter-status').value;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (from)   params.set('from',   from);
  if (to)     params.set('to',     to);
  if (status) params.set('status', status);
  const rows = await api(`/api/staff/reservations?${params}`);
  const tbody = $('resa-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="color:var(--muted);text-align:center;padding:20px">Aucune réservation trouvée</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const n = nights(r.check_in, r.check_out);
    return `<tr>
      <td>#${r.id}</td>
      <td><strong>${r.guest_name}</strong></td>
      <td style="color:var(--muted);font-size:.82rem">${r.guest_email}</td>
      <td>${r.room_number ? r.room_number + ' – ' : ''}${r.room_name}</td>
      <td>${fmtDate(r.check_in)}</td>
      <td>${fmtDate(r.check_out)}</td>
      <td>${n}</td>
      <td>${r.num_guests}</td>
      <td>${Number(r.total_price).toFixed(0)} €</td>
      <td>${statusBadge(r.status)}</td>
      <td>${sourceBadge(r.source)}</td>
      <td><button class="btn-detail" onclick="openDetail(${r.id})">Détails</button></td>
    </tr>`;
  }).join('');
}

$('apply-filters').onclick = loadReservations;
$('reset-filters').onclick = () => {
  $('filter-search').value = '';
  $('filter-from').value   = '';
  $('filter-to').value     = '';
  $('filter-status').value = '';
  loadReservations();
};

/* ── Detail Modal ──────────────────────────────────────────────────────────── */
let currentDetailId = null;

async function openDetail(id) {
  currentDetailId = id;
  const r = await api(`/api/staff/reservations/${id}`);
  const n = nights(r.check_in, r.check_out);
  $('detail-body').innerHTML = `
    <p><strong>N°</strong> ${r.id} &nbsp;·&nbsp; ${statusBadge(r.status)} &nbsp;${sourceBadge(r.source)}</p>
    <p style="margin-top:12px"><strong>Client :</strong> ${r.guest_name}</p>
    <p><strong>Email :</strong> ${r.guest_email}</p>
    <p><strong>Tél. :</strong> ${r.guest_phone || '—'}</p>
    <p style="margin-top:12px"><strong>Chambre :</strong> ${r.room_number ? r.room_number + ' – ' : ''}${r.room_name}</p>
    <p><strong>Arrivée :</strong> ${fmtDate(r.check_in)}</p>
    <p><strong>Départ :</strong> ${fmtDate(r.check_out)} (${n} nuit${n>1?'s':''})</p>
    <p><strong>Voyageurs :</strong> ${r.num_guests}</p>
    <p style="margin-top:12px"><strong>Total :</strong> ${Number(r.total_price).toFixed(2)} €</p>
    ${r.notes ? `<p style="margin-top:12px"><strong>Notes :</strong> ${r.notes}</p>` : ''}
    <p style="margin-top:12px;font-size:.78rem;color:var(--muted)">Créée le ${fmtDate(r.created_at?.slice(0,10))}</p>`;
  $('detail-modal').hidden = false;
}

$('detail-close').onclick = () => { $('detail-modal').hidden = true; };
$('detail-modal').onclick = e => { if (e.target === $('detail-modal')) $('detail-modal').hidden = true; };

$('detail-edit').onclick = () => {
  $('detail-modal').hidden = true;
  editReservation(currentDetailId);
};

$('detail-cancel').onclick = async () => {
  if (!confirm('Annuler cette réservation ?')) return;
  await api(`/api/staff/reservations/${currentDetailId}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
  $('detail-modal').hidden = true;
  loadDashboard();
  loadReservations();
};

$('detail-delete').onclick = async () => {
  if (!confirm('Supprimer définitivement cette réservation ?')) return;
  await api(`/api/staff/reservations/${currentDetailId}`, { method: 'DELETE' });
  $('detail-modal').hidden = true;
  loadReservations();
};

/* ── New / Edit Reservation Form ───────────────────────────────────────────── */
async function initReservationForm(id) {
  $('resa-form-title').textContent = id ? 'Modifier la réservation' : 'Nouvelle réservation';
  $('rf-id').value    = id || '';
  $('rf-submit').textContent = id ? 'Mettre à jour' : 'Enregistrer';

  const rooms = await api('/api/staff/rooms');
  const sel = $('rf-room');
  sel.innerHTML = '<option value="">— Choisir —</option>' +
    rooms.filter(r => r.active).map(r => `<option value="${r.id}">${r.room_number ? r.room_number + ' – ' : ''}${r.name} (${r.price_per_night} €/nuit)</option>`).join('');

  if (id) {
    const r = await api(`/api/staff/reservations/${id}`);
    $('rf-name').value     = r.guest_name;
    $('rf-email').value    = r.guest_email;
    $('rf-phone').value    = r.guest_phone || '';
    $('rf-room').value     = r.room_id;
    $('rf-checkin').value  = r.check_in;
    $('rf-checkout').value = r.check_out;
    $('rf-guests').value   = r.num_guests;
    $('rf-status').value   = r.status;
    $('rf-notes').value    = r.notes || '';
    updatePricePreview();
  } else {
    $('resa-form').reset();
    $('rf-price-preview').hidden = true;
  }
}

async function editReservation(id) {
  switchView('new-reservation');
  await initReservationForm(id);
}

function updatePricePreview() {
  const roomSel = $('rf-room');
  const ci = $('rf-checkin').value, co = $('rf-checkout').value;
  if (!roomSel.value || !ci || !co || co <= ci) { $('rf-price-preview').hidden = true; return; }
  const option = roomSel.options[roomSel.selectedIndex];
  const priceMatch = option.text.match(/(\d+(?:\.\d+)?) €\/nuit/);
  if (!priceMatch) return;
  const n = nights(ci, co);
  const total = n * parseFloat(priceMatch[1]);
  $('rf-price-preview').textContent = `${n} nuit${n>1?'s':''} × ${priceMatch[1]} € = ${total.toFixed(2)} €`;
  $('rf-price-preview').hidden = false;
}

['rf-room','rf-checkin','rf-checkout'].forEach(id => $( id).addEventListener('change', updatePricePreview));

$('resa-form').onsubmit = async e => {
  e.preventDefault();
  const id = $('rf-id').value;
  const body = {
    room_id:    parseInt($('rf-room').value),
    guest_name: $('rf-name').value,
    guest_email:$('rf-email').value,
    guest_phone:$('rf-phone').value,
    check_in:   $('rf-checkin').value,
    check_out:  $('rf-checkout').value,
    num_guests: parseInt($('rf-guests').value),
    status:     $('rf-status').value,
    notes:      $('rf-notes').value,
  };
  const btn = $('rf-submit');
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  try {
    if (id) {
      await api(`/api/staff/reservations/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await api('/api/staff/reservations', { method: 'POST', body: JSON.stringify(body) });
    }
    switchView('reservations');
  } catch (err) {
    alert(`Erreur : ${err.message}`);
    btn.disabled = false; btn.textContent = id ? 'Mettre à jour' : 'Enregistrer';
  }
};

/* ── Occupancy Grid ────────────────────────────────────────────────────────── */
let occOffset = 0; // weeks from today

function initOccupancy() { occOffset = 0; renderOccupancy(); }

$('occ-prev').onclick = () => { occOffset--; renderOccupancy(); };
$('occ-next').onclick = () => { occOffset++; renderOccupancy(); };

async function renderOccupancy() {
  const base  = new Date(); base.setHours(0,0,0,0);
  base.setDate(base.getDate() + occOffset * 14);

  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(base); d.setDate(d.getDate() + i);
    days.push(d);
  }

  const from = days[0].toISOString().slice(0,10);
  const to   = days[days.length-1].toISOString().slice(0,10);
  $('occ-range-label').textContent = `${fmtDate(from)} – ${fmtDate(to)}`;

  const { rooms, reservations } = await api(`/api/staff/occupancy?from=${from}&to=${to}`);

  const todayISO_ = todayISO();
  const grid = $('occ-grid');

  // Header row
  let html = `<div class="occ-header-row">
    <div class="occ-room-col">Chambre</div>
    ${days.map(d => {
      const iso = d.toISOString().slice(0,10);
      const lbl = d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
      return `<div class="occ-day-col${iso===todayISO_?' occ-today':''}">${lbl}</div>`;
    }).join('')}
  </div>`;

  // Room rows
  rooms.forEach(room => {
    const roomResas = reservations.filter(r => r.room_id === room.id);
    html += `<div class="occ-room-row">
      <div class="occ-room-label"><span class="occ-rnum">${room.room_number || ''}</span><span class="occ-rcat">${room.name}</span></div>
      ${days.map((d, di) => {
        const iso = d.toISOString().slice(0,10);
        const resa = roomResas.find(r => r.check_in <= iso && r.check_out > iso);
        let inner = '';
        if (resa) {
          const isFirst = resa.check_in === iso || di === 0;
          if (isFirst) {
            // Compute span
            let span = 0;
            for (let j = di; j < days.length; j++) {
              const dj = days[j].toISOString().slice(0,10);
              if (dj < resa.check_out) span++;
              else break;
            }
            const pct = (span / days.length) * 100;
            inner = `<div class="occ-block status-${resa.status}"
              style="width:${span * 100}%;min-width:${span*44}px;z-index:2;"
              onclick="openDetail(${resa.id})" title="${resa.guest_name}">
              ${span > 1 ? resa.guest_name.split(' ')[0] : ''}
            </div>`;
          }
        }
        return `<div class="occ-cell${iso===todayISO_?' occ-today-col':''}">${inner}</div>`;
      }).join('')}
    </div>`;
  });

  grid.innerHTML = html;
}

/* ── Rooms Management ──────────────────────────────────────────────────────── */
let _allRooms = [];

async function loadRooms() {
  _allRooms = await api('/api/staff/rooms');
  buildCategoryFilter();
  filterRooms($('rooms-category-filter')?.value || '');
}

const TYPE_LABEL_STAFF = { duplex:'Confort en Duplex', superieure:'Chambre Supérieure', prestige:'Chambre Prestige', junior_suite:'Suite Junior', suite:'Suite Prestige' };

function syncCategoryFilter() {
  const sel = $('rooms-category-filter');
  const existing = new Set([...sel.options].map(o => o.value).filter(v => v));
  _allRooms.forEach(r => {
    if (r.type && !existing.has(r.type)) {
      const opt = document.createElement('option');
      opt.value = r.type;
      opt.textContent = TYPE_LABEL_STAFF[r.type] || r.type;
      sel.appendChild(opt);
      existing.add(r.type);
    }
  });
}

function buildCategoryFilter() {
  const sel = $('rooms-category-filter');
  const current = sel.value;
  const types = [...new Set(_allRooms.map(r => r.type).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Toutes les catégories</option>' +
    types.map(t => `<option value="${t}"${t === current ? ' selected' : ''}>${TYPE_LABEL_STAFF[t] || t}</option>`).join('');
}

function filterRooms(type) {
  const rooms = type ? _allRooms.filter(r => r.type === type) : _allRooms;

  const cards = rooms.map(r => `
    <div class="room-admin-card">
      <h3>${r.room_number ? '<span style="font-size:.8em;opacity:.65;font-weight:400">N°</span> ' + r.room_number + ' &ndash; ' : ''}${r.name}</h3>
      <div class="ra-row">
        <div class="ra-field" style="flex:0 0 90px">
          <label for="ra-num-${r.id}">N° chambre</label>
          <input class="ra-input" id="ra-num-${r.id}" value="${r.room_number||''}">
        </div>
        <div class="ra-field" style="flex:1;min-width:120px">
          <label for="ra-name-${r.id}">Nom</label>
          <input class="ra-input" id="ra-name-${r.id}" value="${r.name}">
        </div>
      </div>
      <div class="ra-row">
        <div class="ra-field" style="flex:1;min-width:130px">
          <label for="ra-type-${r.id}">Catégorie</label>
          <input class="ra-input" id="ra-type-${r.id}" value="${r.type||''}">
        </div>
        <div class="ra-field" style="flex:0 0 100px">
          <label for="ra-price-${r.id}">Prix / nuit (€)</label>
          <input class="ra-input" id="ra-price-${r.id}" type="number" value="${r.price_per_night}">
        </div>
        <div class="ra-field" style="flex:0 0 80px">
          <label for="ra-cap-${r.id}">Capacité</label>
          <input class="ra-input" id="ra-cap-${r.id}" type="number" value="${r.capacity}">
        </div>
      </div>
      <div class="ra-field" style="margin-bottom:8px">
        <label for="ra-desc-${r.id}">Description</label>
        <textarea class="ra-input" id="ra-desc-${r.id}" rows="2" style="width:100%">${r.description||''}</textarea>
      </div>
      <div class="ra-toggle">
        <input type="checkbox" id="ra-active-${r.id}" ${r.active ? 'checked' : ''}>
        <label for="ra-active-${r.id}">Chambre active</label>
      </div>
      <div class="ra-save">
        <button class="btn-primary" onclick="saveRoom(${r.id},'${(r.amenities||'').replace(/'/g,"\\'")}')">Enregistrer</button>
      </div>
    </div>`).join('');

  // Carte "+" pour créer une nouvelle chambre
  const addCard = `
    <div class="room-create-card" onclick="openCreateRoomModal()">
      <span class="plus-icon">+</span>
    </div>`;

  $('rooms-admin-grid').innerHTML = addCard + cards;
}

function openCreateRoomModal() {
  $('room-create-form').reset();
  $('nc-error').style.display = 'none';
  $('room-create-modal').hidden = false;
}

$('room-create-close').onclick = () => { $('room-create-modal').hidden = true; };
$('room-create-modal').onclick = e => { if (e.target === $('room-create-modal')) $('room-create-modal').hidden = true; };

$('room-create-form').onsubmit = async e => {
  e.preventDefault();
  const err = $('nc-error');
  err.style.display = 'none';
  const ncNum  = $('nc-num').value.trim();
  const ncName = $('nc-name').value.trim();
  const body = {
    room_number:     ncNum  || null,
    name:            ncName || ncNum || null,   // sera résolu côté serveur si les deux sont vides
    type:            $('nc-type').value.trim().toLowerCase().replace(/\s+/g, '_'),
    price_per_night: parseFloat($('nc-price').value),
    capacity:        parseInt($('nc-cap').value),
    description:     $('nc-desc').value.trim() || null,
    amenities:       $('nc-amenities').value.trim() || null,
  };
  try {
    await api('/api/staff/rooms', { method: 'POST', body: JSON.stringify(body) });
    $('room-create-modal').hidden = true;
    _allRooms = await api('/api/staff/rooms');
    buildCategoryFilter();
    filterRooms($('rooms-category-filter')?.value || '');
  } catch(ex) {
    err.textContent = ex.message || 'Erreur lors de la création';
    err.style.display = 'block';
  }
};

async function saveRoom(id, amenities) {
  const body = {
    room_number:     $(`ra-num-${id}`)?.value || null,
    name:            $(`ra-name-${id}`).value,
    type:            $(`ra-type-${id}`).value.trim().toLowerCase().replace(/\s+/g,'_'),
    capacity:        parseInt($(`ra-cap-${id}`).value),
    price_per_night: parseFloat($(`ra-price-${id}`).value),
    description:     $(`ra-desc-${id}`).value,
    amenities,
    active:          $(`ra-active-${id}`).checked ? 1 : 0,
  };
  const btn = document.querySelector(`[onclick*="saveRoom(${id},"]`);
  try {
    await api(`/api/staff/rooms/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    btn.textContent = '✓ Sauvegardé';
    btn.disabled = true;
    // Re-fetch depuis le serveur pour garantir la cohérence (catégorie, encodage, etc.)
    _allRooms = await api('/api/staff/rooms');
    const currentFilter = $('rooms-category-filter')?.value || '';
    buildCategoryFilter();
    filterRooms(currentFilter);
    // Le bouton est recréé par filterRooms, donc on cible le nouveau
    const newBtn = document.querySelector(`[onclick*="saveRoom(${id},"]`);
    if (newBtn) { newBtn.textContent = '✓ Sauvegardé'; newBtn.disabled = true; }
    setTimeout(() => {
      const b = document.querySelector(`[onclick*="saveRoom(${id},"]`);
      if (b) { b.textContent = 'Enregistrer'; b.disabled = false; }
    }, 1800);
  } catch(e) {
    btn.textContent = '⚠ Erreur';
    setTimeout(() => { btn.textContent = 'Enregistrer'; btn.disabled = false; }, 2000);
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   HOUSEKEEPING
   ════════════════════════════════════════════════════════════════════════════ */

const HK_STATUS = {
  pending:     { label: 'À faire',   cls: 'status-pending' },
  in_progress: { label: 'En cours',  cls: 'status-in_progress' },
  done:        { label: 'Terminée',  cls: 'status-done' },
};

function initHousekeeping() {
  const dateInput = $('hk-date');
  dateInput.value = todayISO();
  loadHousekeeping();
  dateInput.onchange = loadHousekeeping;
  $('hk-generate-btn').onclick = generateHousekeeping;
}

async function loadHousekeeping() {
  const date  = $('hk-date').value;
  const tasks = await api(`/api/staff/housekeeping?date=${date}`);
  const emps  = await api('/api/staff/employees');
  const chambermaids = emps.filter(e => e.active && (e.role === 'femme_de_chambre' || e.role === 'extras'));

  const recouche = tasks.filter(t => t.type === 'recouche');
  const blanc    = tasks.filter(t => t.type === 'mise_a_blanc');
  const pending  = tasks.filter(t => t.status === 'pending').length;
  const inProg   = tasks.filter(t => t.status === 'in_progress').length;
  const done     = tasks.filter(t => t.status === 'done').length;

  $('hk-recouche-count').textContent = recouche.length;
  $('hk-blanc-count').textContent    = blanc.length;
  $('hk-stats').innerHTML = `
    <div class="hk-stat s-pending"><strong>${pending}</strong>À faire</div>
    <div class="hk-stat s-progress"><strong>${inProg}</strong>En cours</div>
    <div class="hk-stat s-done"><strong>${done}</strong>Terminées</div>
    <div class="hk-stat"><strong>${tasks.length}</strong>Total</div>`;

  $('hk-recouche-list').innerHTML = recouche.length
    ? recouche.map(t => hkCardHTML(t, chambermaids)).join('')
    : `<div class="hk-empty">Aucune recouche pour cette date</div>`;
  $('hk-blanc-list').innerHTML = blanc.length
    ? blanc.map(t => hkCardHTML(t, chambermaids)).join('')
    : `<div class="hk-empty">Aucune mise à blanc pour cette date</div>`;
}

function hkCardHTML(task, employees) {
  const empOptions = employees.map(e =>
    `<option value="${e.id}" ${task.employee_id === e.id ? 'selected' : ''}>${e.first_name} ${e.last_name}</option>`
  ).join('');
  return `
    <div class="hk-card ${HK_STATUS[task.status]?.cls || ''}" id="hkcard-${task.id}">
      <div class="hk-card-top">
        <span class="hk-room-name">🛏️ ${task.room_number ? task.room_number + ' – ' : ''}${task.room_name}</span>
        <select class="hk-status-select" onchange="updateHkStatus(${task.id}, this.value)">
          ${Object.entries(HK_STATUS).map(([v,d]) => `<option value="${v}" ${task.status===v?'selected':''}>${d.label}</option>`).join('')}
        </select>
      </div>
      <div class="hk-row">
        <select id="hk-emp-${task.id}">
          <option value="">— Attribuer à —</option>
          ${empOptions}
        </select>
        <input type="text" id="hk-notes-${task.id}" placeholder="Notes…" value="${task.notes||''}">
        <button class="hk-save-btn" onclick="saveHkCard(${task.id})">✓</button>
      </div>
    </div>`;
}

async function updateHkStatus(id, status) {
  const card = $(`hkcard-${id}`);
  // Update card class immediately for responsiveness
  Object.values(HK_STATUS).forEach(d => card.classList.remove(d.cls));
  card.classList.add(HK_STATUS[status]?.cls || '');
  await api(`/api/staff/housekeeping/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status, employee_id: parseInt($(`hk-emp-${id}`)?.value)||null, notes: $(`hk-notes-${id}`)?.value }),
  });
}

async function saveHkCard(id) {
  const status = document.querySelector(`#hkcard-${id} .hk-status-select`).value;
  const employee_id = parseInt($(`hk-emp-${id}`).value) || null;
  const notes       = $(`hk-notes-${id}`).value;
  await api(`/api/staff/housekeeping/${id}`, { method: 'PUT', body: JSON.stringify({ status, employee_id, notes }) });
  const btn = document.querySelector(`#hkcard-${id} .hk-save-btn`);
  btn.textContent = '✓ OK';
  setTimeout(() => { btn.textContent = '✓'; }, 1500);
}

async function generateHousekeeping() {
  const date = $('hk-date').value;
  const btn  = $('hk-generate-btn');
  btn.disabled = true; btn.textContent = 'Génération…';
  try {
    const { created } = await api('/api/staff/housekeeping/generate', { method: 'POST', body: JSON.stringify({ date }) });
    await loadHousekeeping();
    if (created === 0) btn.textContent = '✓ Déjà à jour';
    else btn.textContent = `✓ ${created} tâche${created > 1 ? 's' : ''} créée${created > 1 ? 's' : ''}`;
  } catch (err) {
    alert(`Erreur : ${err.message}`);
    btn.textContent = '⚡ Générer les tâches';
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = '⚡ Générer les tâches'; }, 2500);
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   PLANNING ÉQUIPE
   ════════════════════════════════════════════════════════════════════════════ */

let planWeekOffset = 0;
let planEmployees  = [];
let planShifts     = [];

const SHIFT_DEFAULTS = {
  matin:      { start: '07:00', end: '15:00', label: 'Matin',      bg: '#dbeafe', color: '#1e40af' },
  apres_midi: { start: '15:00', end: '23:00', label: 'Après-midi', bg: '#fce7f3', color: '#9d174d' },
  journee:    { start: '09:00', end: '17:00', label: 'Journée',    bg: '#d1fae5', color: '#065f46' },
  coupure:    { start: '07:00', end: '23:00', label: 'Coupure',    bg: '#fef3c7', color: '#92400e' },
  repos:      { start: null,    end: null,    label: 'Repos',      bg: '#f3f4f6', color: '#6b7280' },
  conge:      { start: null,    end: null,    label: 'Congé',      bg: '#fffbeb', color: '#92400e' },
  maladie:    { start: null,    end: null,    label: 'Maladie',    bg: '#fee2e2', color: '#991b1b' },
};

function planWeekDays(offset = 0) {
  const base = new Date(); base.setHours(0,0,0,0);
  const dow  = (base.getDay() + 6) % 7; // Mon = 0
  base.setDate(base.getDate() - dow + offset * 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(base); d.setDate(d.getDate() + i); return d; });
}

function initPlanning() { planWeekOffset = 0; renderPlanning(); }

$('plan-prev').onclick   = () => { planWeekOffset--; renderPlanning(); };
$('plan-next').onclick   = () => { planWeekOffset++; renderPlanning(); };
$('plan-print').onclick  = () => window.print();

async function renderPlanning() {
  planEmployees = await api('/api/staff/employees');
  const days    = planWeekDays(planWeekOffset);
  const from    = days[0].toISOString().slice(0,10);
  const to      = days[6].toISOString().slice(0,10);
  planShifts    = await api(`/api/staff/shifts?from=${from}&to=${to}`);

  const todayStr = todayISO();
  const weekLabel = `${days[0].toLocaleDateString('fr-FR',{day:'numeric',month:'long'})} — ${days[6].toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}`;
  $('plan-week-label').textContent  = weekLabel;
  $('plan-print-range').textContent = `Semaine du ${weekLabel}`;

  const DAY_FR = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

  let html = `<div class="plan-header-row">
    <div class="plan-emp-col">Employé</div>
    ${days.map((d,i) => {
      const iso = d.toISOString().slice(0,10);
      const isToday   = iso === todayStr;
      const isWeekend = i >= 5;
      return `<div class="plan-day-col${isToday?' plan-today':''}${isWeekend?' plan-weekend':''}">
        ${DAY_FR[i]}<br><strong>${d.getDate()}</strong>
      </div>`;
    }).join('')}
  </div>`;

  planEmployees.filter(e => e.active).forEach(emp => {
    html += `<div class="plan-emp-row">
      <div class="plan-emp-label">
        <div class="plan-emp-dot" style="background:${emp.color}"></div>
        <div>
          <div class="plan-emp-name">${emp.first_name} ${emp.last_name}</div>
          <div class="plan-emp-role">${roleLabel(emp.role)}</div>
        </div>
      </div>
      ${days.map((d,i) => {
        const iso     = d.toISOString().slice(0,10);
        const shift   = planShifts.find(s => s.employee_id === emp.id && s.date === iso);
        const isToday = iso === todayStr;
        const cfg     = shift ? (SHIFT_DEFAULTS[shift.type] || SHIFT_DEFAULTS.journee) : null;
        const inner   = shift
          ? `<div class="plan-shift-block" style="background:${cfg.bg};color:${cfg.color}">
               ${cfg.label}
               ${shift.start_time && shift.end_time ? `<span class="shift-time">${shift.start_time}–${shift.end_time}</span>` : ''}
             </div>`
          : '';
        return `<div class="plan-cell${isToday?' plan-today-col':''}"
                     onclick="openShiftModal(${emp.id},'${iso}',${shift ? shift.id : 'null'})"
                     title="${emp.first_name} · ${d.toLocaleDateString('fr-FR')}">${inner}</div>`;
      }).join('')}
    </div>`;
  });

  $('plan-grid').innerHTML = html;
}

function roleLabel(role) {
  return { femme_de_chambre:'Chambre', receptionniste:'Réception', responsable:'Responsable', maintenance:'Maintenance', extras:'Extras' }[role] || role;
}

/* ── Shift modal ────────────────────────────────────────────────────────────── */
let currentShiftId = null;

function openShiftModal(empId, date, shiftId) {
  currentShiftId = shiftId;
  const emp = planEmployees.find(e => e.id === empId);
  $('sf-employee-id').value = empId;
  $('sf-date').value        = date;
  $('sf-id').value          = shiftId || '';
  $('shift-modal-title').textContent = shiftId ? 'Modifier la plage' : 'Ajouter une plage';
  $('shift-modal-sub').textContent   = `${emp ? emp.first_name + ' ' + emp.last_name : ''} · ${new Date(date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}`;
  $('sf-delete').style.display = shiftId ? '' : 'none';

  if (shiftId) {
    const s = planShifts.find(s => s.id === shiftId);
    if (s) {
      $('sf-type').value  = s.type;
      $('sf-start').value = s.start_time || '';
      $('sf-end').value   = s.end_time   || '';
      $('sf-notes').value = s.notes      || '';
    }
  } else {
    $('sf-type').value  = 'journee';
    $('sf-start').value = '09:00';
    $('sf-end').value   = '17:00';
    $('sf-notes').value = '';
  }
  updateShiftTimeVisibility();
  $('shift-modal').hidden = false;
}

function updateShiftTimeVisibility() {
  const type = $('sf-type').value;
  const hide = ['repos','conge','maladie'].includes(type);
  $('sf-time-fields').style.display = hide ? 'none' : 'flex';
  if (!hide) {
    const def = SHIFT_DEFAULTS[type];
    if (def && !currentShiftId) {
      $('sf-start').value = def.start || '';
      $('sf-end').value   = def.end   || '';
    }
  }
}

$('sf-type').onchange = updateShiftTimeVisibility;

$('shift-modal-close').onclick = () => { $('shift-modal').hidden = true; };
$('shift-modal').onclick = e => { if (e.target === $('shift-modal')) $('shift-modal').hidden = true; };

$('sf-delete').onclick = async () => {
  if (!currentShiftId || !confirm('Supprimer cette plage ?')) return;
  await api(`/api/staff/shifts/${currentShiftId}`, { method: 'DELETE' });
  $('shift-modal').hidden = true;
  renderPlanning();
};

$('shift-form').onsubmit = async e => {
  e.preventDefault();
  const type = $('sf-type').value;
  const hide = ['repos','conge','maladie'].includes(type);
  const body = {
    employee_id: parseInt($('sf-employee-id').value),
    date:        $('sf-date').value,
    type,
    start_time:  hide ? null : ($('sf-start').value || null),
    end_time:    hide ? null : ($('sf-end').value   || null),
    notes:       $('sf-notes').value || null,
  };
  const id = $('sf-id').value;
  if (id) await api(`/api/staff/shifts/${id}`, { method: 'PUT',  body: JSON.stringify(body) });
  else    await api('/api/staff/shifts',        { method: 'POST', body: JSON.stringify(body) });
  $('shift-modal').hidden = true;
  renderPlanning();
};

/* ════════════════════════════════════════════════════════════════════════════
   PERSONNEL
   ════════════════════════════════════════════════════════════════════════════ */

const ROLE_LABELS = {
  femme_de_chambre: 'Femme / Valet de chambre',
  receptionniste:   'Réceptionniste',
  responsable:      'Responsable / Manager',
  maintenance:      'Maintenance',
  extras:           'Extras / Saisonnier',
};

async function loadPersonnel() {
  const emps = await api('/api/staff/employees');
  const grid = $('employees-grid');
  if (!emps.length) { grid.innerHTML = `<p style="color:var(--muted)">Aucun employé enregistré.</p>`; return; }
  grid.innerHTML = emps.map(e => {
    const initials = (e.first_name[0] + e.last_name[0]).toUpperCase();
    return `
    <div class="emp-card${e.active ? '' : ' inactive'}">
      <div class="emp-card-top">
        <div class="emp-avatar" style="background:${e.color}">${initials}</div>
        <div class="emp-info">
          <h3>${e.first_name} ${e.last_name}</h3>
          ${e.active
            ? `<span class="emp-role-badge">${ROLE_LABELS[e.role] || e.role}</span>`
            : `<span class="emp-inactive-badge">Inactif</span>`}
        </div>
      </div>
      <div class="emp-card-details">
        ${e.phone ? `<span>📞 ${e.phone}</span>` : ''}
        ${e.email ? `<span>✉️ ${e.email}</span>` : ''}
        ${e.notes ? `<span>📝 ${e.notes}</span>` : ''}
      </div>
      <div class="emp-card-actions">
        <button class="btn-secondary" style="flex:1" onclick="openEmployeeModal(${e.id})">Modifier</button>
      </div>
    </div>`;
  }).join('');
}

$('add-employee-btn').onclick = () => openEmployeeModal(null);

function openEmployeeModal(id) {
  const emp = id ? null : null; // will be fetched below if needed
  $('ef-id').value = id || '';
  $('emp-modal-title').textContent = id ? 'Modifier l\'employé' : 'Nouvel employé';

  if (id) {
    api('/api/staff/employees').then(emps => {
      const e = emps.find(x => x.id === id);
      if (!e) return;
      $('ef-firstname').value = e.first_name;
      $('ef-lastname').value  = e.last_name;
      $('ef-role').value      = e.role;
      $('ef-phone').value     = e.phone  || '';
      $('ef-email').value     = e.email  || '';
      $('ef-color').value     = e.color  || '#2d6a4f';
      $('ef-notes').value     = e.notes  || '';
      $('ef-deactivate').textContent = e.active ? 'Désactiver' : 'Réactiver';
    });
  } else {
    $('employee-form').reset();
    $('ef-color').value = '#2d6a4f';
    $('ef-deactivate').textContent = 'Désactiver';
  }
  $('ef-deactivate').style.display = id ? '' : 'none';
  $('employee-modal').hidden = false;
}

$('emp-modal-close').onclick = () => { $('employee-modal').hidden = true; };
$('employee-modal').onclick  = e => { if (e.target === $('employee-modal')) $('employee-modal').hidden = true; };

$('ef-deactivate').onclick = async () => {
  const id = $('ef-id').value;
  if (!id) return;
  const emps = await api('/api/staff/employees');
  const emp  = emps.find(e => e.id === parseInt(id));
  if (!emp) return;
  const newActive = emp.active ? 0 : 1;
  await api(`/api/staff/employees/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...emp, active: newActive }),
  });
  $('employee-modal').hidden = true;
  loadPersonnel();
};

$('employee-form').onsubmit = async e => {
  e.preventDefault();
  const id   = $('ef-id').value;
  const body = {
    first_name: $('ef-firstname').value,
    last_name:  $('ef-lastname').value,
    role:       $('ef-role').value,
    phone:      $('ef-phone').value  || null,
    email:      $('ef-email').value  || null,
    color:      $('ef-color').value,
    notes:      $('ef-notes').value  || null,
    active:     1,
  };
  const btn = $('ef-submit');
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  try {
    if (id) await api(`/api/staff/employees/${id}`, { method: 'PUT',  body: JSON.stringify(body) });
    else    await api('/api/staff/employees',        { method: 'POST', body: JSON.stringify(body) });
    $('employee-modal').hidden = true;
    loadPersonnel();
  } catch (err) {
    alert(`Erreur : ${err.message}`);
  } finally {
    btn.disabled = false; btn.textContent = 'Enregistrer';
  }
};
