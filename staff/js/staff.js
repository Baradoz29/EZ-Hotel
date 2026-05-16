/* ── Photo categories ──────────────────────────────────────────────────────── */
const PHOTO_CATS = [
  { id: 'chambre',       label: 'Chambre',        icon: '🛏️' },
  { id: 'salle_de_bain', label: 'Salle de bain',  icon: '🚿' },
  { id: 'salon',         label: 'Salon & Séjour', icon: '🛋️' },
  { id: 'vue',           label: 'Vue & Jardin',   icon: '🌿' },
  { id: 'equipements',   label: 'Équipements',    icon: '✨' },
  { id: 'general',       label: 'Général',        icon: '📷' },
];

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
const localISO = d => { const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; };
const todayISO = () => localISO(new Date());

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
  if (name === 'categories')       loadCategories();
  if (name === 'new-reservation')  initReservationForm(null);
  if (name === 'housekeeping')     initHousekeeping();
  if (name === 'planning')         initPlanning();
  if (name === 'personnel')        loadPersonnel();
  if (name === 'reviews')          loadReviews();
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

const STRIPE_STATUS_LABELS = {
  captured:            { text: 'Débité',                  cls: 'badge-confirmed' },
  authorized:          { text: 'Préautorisé (non débité)', cls: 'badge-pending'   },
  refunded:            { text: 'Remboursé intégralement',  cls: 'badge-cancelled' },
  partially_refunded:  { text: 'Remboursé partiellement',  cls: 'badge-pending'   },
  released:            { text: 'Autorisation libérée',     cls: 'badge-cancelled' },
  captured_penalty:    { text: '1ère nuit débitée',        cls: 'badge-cancelled' },
  no_refund:           { text: 'Non remboursé',            cls: 'badge-cancelled' },
  cancelled_manually:  { text: 'Annulée manuellement',     cls: 'badge-cancelled' },
};

function stripeBadge(status) {
  if (!status) return '';
  const s = STRIPE_STATUS_LABELS[status] || { text: status, cls: 'badge-pending' };
  return `<span class="badge ${s.cls}" style="font-size:.72rem">${s.text}</span>`;
}

function cancelPreview(r) {
  const deadline    = new Date(r.check_in + 'T00:00:00').getTime() - 48 * 3600 * 1000;
  const isInTime    = Date.now() < deadline;
  const deadlineFmt = new Date(deadline).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const hasStripe   = r.stripe_payment_intent_id && r.payment_mode;
  const firstNight  = Number(r.room_price  || 0);
  const total       = Number(r.total_price || 0);

  if (isInTime) {
    let action = 'Aucun frais d\'annulation.';
    if (hasStripe && r.payment_mode === 'online')      action = `Remboursement intégral de <strong>${total.toFixed(2)} €</strong> via Stripe.`;
    if (hasStripe && r.payment_mode === 'on_arrival')  action = 'Autorisation libérée — <strong>aucun débit</strong>.';
    return { ok: true, title: '✓ Annulation gratuite', action, deadline: `Délai gratuit jusqu'au ${deadlineFmt}` };
  } else {
    let action = `1ère nuit facturée (<strong>${firstNight.toFixed(2)} €</strong>).`;
    if (hasStripe && r.payment_mode === 'online') {
      const refund = Math.max(0, total - firstNight);
      action = refund > 0
        ? `1ère nuit retenue · Remboursement de <strong>${refund.toFixed(2)} €</strong> via Stripe.`
        : `1ère nuit retenue · Séjour d'une nuit — aucun remboursement.`;
    }
    if (hasStripe && r.payment_mode === 'on_arrival') action = `1ère nuit débitée (<strong>${firstNight.toFixed(2)} €</strong>) via Stripe.`;
    return { ok: false, title: '⚠️ Annulation tardive', action, deadline: `Délai gratuit expiré le ${deadlineFmt}` };
  }
}

async function openDetail(id) {
  currentDetailId = id;
  const r = await api(`/api/staff/reservations/${id}`);
  const n = nights(r.check_in, r.check_out);

  const pmLabel = { online: '💳 Paiement en ligne', on_arrival: '🏨 Garantie carte, paiement sur place' };
  const paymentBlock = (r.payment_mode || r.stripe_payment_intent_id) ? `
    <p style="margin-top:12px"><strong>Paiement :</strong> ${pmLabel[r.payment_mode] || '—'} ${stripeBadge(r.stripe_status)}</p>
    ${r.stripe_payment_intent_id ? `<p style="font-size:.75rem;color:var(--muted)">PI : ${r.stripe_payment_intent_id}</p>` : ''}` : '';

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
    ${r.breakfast ? '<p><strong>Petit-déjeuner :</strong> Inclus</p>' : ''}
    ${r.arrival_time ? `<p><strong>Arrivée prévue :</strong> ${r.arrival_time}</p>` : ''}
    ${paymentBlock}
    ${r.notes ? `<p style="margin-top:12px"><strong>Notes :</strong> ${r.notes}</p>` : ''}
    <p style="margin-top:12px;font-size:.78rem;color:var(--muted)">Créée le ${fmtDate(r.created_at?.slice(0,10))}</p>`;

  $('detail-cancel').disabled = r.status === 'cancelled';
  $('detail-modal').hidden = false;
}

$('detail-close').onclick = () => { $('detail-modal').hidden = true; };
$('detail-modal').onclick = e => { if (e.target === $('detail-modal')) $('detail-modal').hidden = true; };

$('detail-edit').onclick = () => {
  $('detail-modal').hidden = true;
  editReservation(currentDetailId);
};

$('detail-cancel').onclick = async () => {
  const r = await api(`/api/staff/reservations/${currentDetailId}`);
  const preview = cancelPreview(r);

  $('cancel-modal-title').textContent = preview.title;
  $('cancel-modal-body').innerHTML = `
    <p style="margin-bottom:8px">${preview.action}</p>
    <p style="font-size:.78rem;color:var(--muted)">${preview.deadline}</p>
    ${!preview.ok ? '<p style="margin-top:10px;font-size:.82rem;color:#b91c1c">Cette action est irréversible.</p>' : ''}`;

  $('detail-modal').hidden = true;
  $('cancel-modal').hidden = false;
};

$('cancel-modal-close').onclick  = () => { $('cancel-modal').hidden = true; };
$('cancel-modal-abort').onclick  = () => { $('cancel-modal').hidden = true; };
$('cancel-modal').onclick = e => { if (e.target === $('cancel-modal')) $('cancel-modal').hidden = true; };

$('cancel-modal-ok').onclick = async () => {
  const btn = $('cancel-modal-ok');
  btn.disabled = true; btn.textContent = 'Traitement…';
  try {
    const result = await api(`/api/staff/reservations/${currentDetailId}/cancel`, { method: 'POST' });
    $('cancel-modal').hidden = true;
    const msgs = {
      refunded:           'Remboursement intégral effectué via Stripe.',
      partially_refunded: 'Remboursement partiel effectué via Stripe. 1ère nuit conservée.',
      released:           'Autorisation libérée — aucun débit sur la carte du client.',
      captured_penalty:   '1ère nuit débitée via Stripe (annulation tardive).',
      no_refund:          'Annulation effectuée. Aucun remboursement (séjour d\'une nuit).',
    };
    if (result.stripeAction && msgs[result.stripeAction]) alert(msgs[result.stripeAction]);
    loadDashboard();
    loadReservations();
  } catch(err) {
    alert(`Erreur : ${err.message}`);
    btn.disabled = false; btn.textContent = "Confirmer l'annulation";
  }
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

  const from = localISO(days[0]);
  const to   = localISO(days[days.length-1]);
  $('occ-range-label').textContent = `${fmtDate(from)} – ${fmtDate(to)}`;

  const { rooms, reservations } = await api(`/api/staff/occupancy?from=${from}&to=${to}`);

  const todayISO_ = todayISO();
  const grid = $('occ-grid');

  // Header row
  let html = `<div class="occ-header-row">
    <div class="occ-room-col">Chambre</div>
    ${days.map(d => {
      const iso = localISO(d);
      const lbl = d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
      return `<div class="occ-day-col${iso===todayISO_?' occ-today':''}">${lbl}</div>`;
    }).join('')}
  </div>`;

  // Room rows
  const ROOM_COL = 160; // px — largeur colonne chambre (doit correspondre au CSS)
  const N = days.length;

  rooms.forEach(room => {
    const roomResas = reservations.filter(r => r.room_id === room.id);

    // ── Cellules ──────────────────────────────────────────────────────────────
    const cells = days.map((d, di) => {
      const iso = localISO(d);
      const depResa = roomResas.find(r => r.check_out === iso);
      const arrResa = roomResas.find(r => r.check_in  === iso);
      const midResa = roomResas.find(r => r.check_in < iso && r.check_out > iso);

      let segs = '';
      if (depResa || arrResa) {
        if (depResa) segs += `<div class="occ-seg occ-left  status-${depResa.status}" onclick="openDetail(${depResa.id})" title="${depResa.guest_name} — Départ"></div>`;
        if (arrResa) segs += `<div class="occ-seg occ-right status-${arrResa.status}" onclick="openDetail(${arrResa.id})" title="${arrResa.guest_name} — Arrivée"></div>`;
      } else if (midResa) {
        segs = `<div class="occ-seg occ-full status-${midResa.status}" onclick="openDetail(${midResa.id})" title="${midResa.guest_name}"></div>`;
      }
      return `<div class="occ-cell${iso===todayISO_?' occ-today-col':''}">${segs}</div>`;
    }).join('');

    // ── Labels flottants — un par réservation visible ─────────────────────────
    // Positionnés sur la ligne (position:relative), pas dans la cellule,
    // pour pouvoir s'étaler librement sur toute la durée du séjour.
    const seen = new Set();
    let labels = '';
    const cw = `(100% - ${ROOM_COL}px) / ${N}`; // largeur d'une cellule en CSS

    days.forEach((d, di) => {
      const iso = localISO(d);
      let resa = null, halfStart = false;

      // Arrivée dans la fenêtre → label commence à la demi-droite
      const arr = roomResas.find(r => r.check_in === iso);
      if (arr && !seen.has(arr.id)) { resa = arr; halfStart = true; }

      // Séjour en cours au début de la fenêtre → label bord gauche de di=0
      if (!resa && di === 0) {
        const mid = roomResas.find(r => r.check_in < iso && r.check_out > iso);
        if (mid && !seen.has(mid.id)) { resa = mid; halfStart = false; }
      }

      // Départ exactement au premier jour → demi-barre gauche seulement à di=0
      if (!resa && di === 0) {
        const dep = roomResas.find(r => r.check_out === iso && r.check_in < iso);
        if (dep && !seen.has(dep.id)) { resa = dep; halfStart = false; }
      }

      if (!resa) return;
      seen.add(resa.id);

      // Jours du séjour visibles dans la fenêtre (check_out exclu)
      const vis = days.filter(day => {
        const s = localISO(day);
        return s >= resa.check_in && s < resa.check_out;
      }).length;

      // Si le départ est visible dans cette fenêtre, étendre le label d'une demi-cellule
      const depInWindow = days.some(day => localISO(day) === resa.check_out);
      const extraHalf   = depInWindow ? 0.5 : 0;

      const xOff  = halfStart ? 0.5 : 0;
      const left  = `calc(${ROOM_COL}px + (${di} + ${xOff}) * (${cw}) + 7px)`;
      const width = `calc((${vis} + ${extraHalf} - ${xOff}) * (${cw}) - 10px)`;
      const bg    = resa.status === 'pending' ? '#f59e0b' : '#2d6a4f';

      labels += `<div class="occ-name-label" style="left:${left};width:${width};background:${bg}" onclick="openDetail(${resa.id})">${resa.guest_name.toUpperCase()}</div>`;
    });

    html += `<div class="occ-room-row">
      <div class="occ-room-label"><span class="occ-rnum">${room.room_number || ''}</span><span class="occ-rcat">${room.name}</span></div>
      ${cells}${labels}
    </div>`;
  });

  grid.innerHTML = html;
}

/* ── Rooms Management ──────────────────────────────────────────────────────── */
let _allRooms = [];
let _allCategories = [];
let _descCache = {};       // { roomId: { fr:'', en:'', de:'', es:'', it:'' } }
let _createDescCache = {}; // same structure for the create modal

const escapeHtml = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function parseDescObj(raw) {
  const base = { fr:'', en:'', de:'', es:'', it:'' };
  if (!raw) return base;
  try {
    const p = JSON.parse(raw);
    if (typeof p === 'object' && p !== null) return { ...base, ...p };
  } catch(e) {}
  return { ...base, fr: raw };
}

function switchDescLang(sel, id) {
  const prevLang = sel.dataset.prevLang || 'fr';
  if (!_descCache[id]) _descCache[id] = parseDescObj('');
  _descCache[id][prevLang] = $(`ra-desc-${id}`).value;
  const newLang = sel.value;
  $(`ra-desc-${id}`).value = _descCache[id][newLang] || '';
  sel.dataset.prevLang = newLang;
}

function switchCreateDescLang(sel) {
  const prevLang = sel.dataset.prevLang || 'fr';
  _createDescCache[prevLang] = ($('nc-desc').value || '').trim();
  const newLang = sel.value;
  $('nc-desc').value = _createDescCache[newLang] || '';
  sel.dataset.prevLang = newLang;
}

const LANG_NAMES = { fr:'Français', en:'English', de:'Deutsch', es:'Español', it:'Italiano' };

async function _callMyMemory(text, from, to) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.responseStatus !== 200) throw new Error(data.responseDetails || 'Erreur API');
  return data.responseData.translatedText;
}

async function translateDescAllLangs(id) {
  const langSel = $(`ra-desc-lang-${id}`);
  const srcLang = langSel ? langSel.value : 'fr';
  if (!_descCache[id]) _descCache[id] = parseDescObj('');
  _descCache[id][srcLang] = $(`ra-desc-${id}`).value.trim();
  const text = _descCache[id][srcLang];
  if (!text) return;

  const btn = $(`ra-translate-${id}`);
  if (btn) { btn.disabled = true; btn.className = 'ra-translate-btn loading'; btn.textContent = '⏳'; }

  const targets = ['fr','en','de','es','it'].filter(l => l !== srcLang);
  let errors = 0;
  await Promise.all(targets.map(async tgt => {
    try {
      _descCache[id][tgt] = await _callMyMemory(text, srcLang, tgt);
    } catch(e) { errors++; }
  }));

  if (btn) {
    btn.disabled = false;
    btn.className = `ra-translate-btn ${errors ? 'error' : 'success'}`;
    btn.textContent = errors ? '⚠ Partiel' : '✓ Traduit';
    setTimeout(() => { btn.className = 'ra-translate-btn'; btn.textContent = '🌐 Traduire'; }, 2200);
  }
}

async function translateCreateDescAllLangs() {
  const langSel = $('nc-desc-lang');
  const srcLang = langSel ? langSel.value : 'fr';
  _createDescCache[srcLang] = ($('nc-desc').value || '').trim();
  const text = _createDescCache[srcLang];
  if (!text) return;

  const btn = $('nc-translate-btn');
  if (btn) { btn.disabled = true; btn.className = 'ra-translate-btn loading'; btn.textContent = '⏳'; }

  const targets = ['fr','en','de','es','it'].filter(l => l !== srcLang);
  let errors = 0;
  await Promise.all(targets.map(async tgt => {
    try {
      _createDescCache[tgt] = await _callMyMemory(text, srcLang, tgt);
    } catch(e) { errors++; }
  }));

  if (btn) {
    btn.disabled = false;
    btn.className = `ra-translate-btn ${errors ? 'error' : 'success'}`;
    btn.textContent = errors ? '⚠ Partiel' : '✓ Traduit';
    setTimeout(() => { btn.className = 'ra-translate-btn'; btn.textContent = '🌐 Traduire'; }, 2200);
  }
}

function photoThumbHTML(roomId, photo) {
  const cat = photo.category || 'general';
  return `<div class="ra-photo-thumb" id="ra-photo-${photo.id}" data-category="${cat}">
    <img src="/assets/images/rooms/${roomId}/${photo.filename}" alt="" loading="lazy">
    <button class="ra-photo-del" onclick="deleteRoomPhoto(${roomId},${photo.id})" title="Supprimer">×</button>
  </div>`;
}

async function uploadRoomPhotos(roomId, input, category = 'general') {
  const files = [...input.files];
  if (!files.length) return;
  const grid = $(`ra-photos-${roomId}-${category}`);
  for (const file of files) {
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('category', category);
    try {
      const res = await fetch(`/api/staff/rooms/${roomId}/photos`, { method: 'POST', body: fd });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Erreur upload'); }
      const data = await res.json();
      if (grid) {
        const noPhotos = grid.querySelector('.ra-no-photos');
        if (noPhotos) noPhotos.remove();
        const div = document.createElement('div');
        div.innerHTML = photoThumbHTML(roomId, data);
        grid.appendChild(div.firstElementChild);
      }
    } catch(e) { alert(`Upload échoué : ${e.message}`); }
  }
  input.value = '';
}

async function deleteRoomPhoto(roomId, photoId) {
  if (!confirm('Supprimer cette photo ?')) return;
  try {
    const res = await fetch(`/api/staff/rooms/${roomId}/photos/${photoId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Erreur serveur');
    const el = $(`ra-photo-${photoId}`);
    if (el) {
      const cat = el.dataset.category || 'general';
      el.remove();
      const grid = $(`ra-photos-${roomId}-${cat}`);
      if (grid && !grid.querySelector('.ra-photo-thumb')) {
        grid.innerHTML = '<span class="ra-no-photos">Aucune photo</span>';
      }
    }
  } catch(e) { alert(`Erreur : ${e.message}`); }
}

/* ── Amenity tag input helpers ─────────────────────────────────────────────── */
function focusTagInput(id) { $(`ra-amenities-${id}`)?.focus(); }

function addRaTag(id, text) {
  const wrap = $(`ra-amenities-wrap-${id}`);
  const input = $(`ra-amenities-${id}`);
  if (!wrap || !input || !text.trim()) return;
  const tag = document.createElement('span');
  tag.className = 'ra-tag';
  tag.innerHTML = `${escapeHtml(text.trim())}<button type="button" class="ra-tag-del" onclick="event.stopPropagation();this.closest('.ra-tag').remove()">×</button>`;
  wrap.insertBefore(tag, input);
}

function handleTagKey(e, id) {
  const input = e.target;
  if (e.key === ',' || e.key === 'Enter') {
    e.preventDefault();
    const val = input.value.replace(/,/g, '').trim();
    if (val) addRaTag(id, val);
    input.value = '';
  } else if (e.key === 'Backspace' && !input.value) {
    const wrap = $(`ra-amenities-wrap-${id}`);
    const tags = wrap?.querySelectorAll('.ra-tag');
    if (tags?.length) tags[tags.length - 1].remove();
  }
}

function handleTagInput(e, id) {
  const input = e.target;
  if (!input.value.includes(',')) return;
  const parts = input.value.split(',');
  parts.slice(0, -1).forEach(p => { if (p.trim()) addRaTag(id, p.trim()); });
  input.value = parts[parts.length - 1];
}

function handleTagBlur(e, id) {
  const val = e.target.value.replace(/,/g, '').trim();
  if (val) addRaTag(id, val);
  e.target.value = '';
}

function getTagValues(id) {
  const wrap = $(`ra-amenities-wrap-${id}`);
  if (!wrap) return null;
  const tags = [...wrap.querySelectorAll('.ra-tag')]
    .map(t => t.childNodes[0]?.textContent?.trim())
    .filter(Boolean);
  const inputVal = $(`ra-amenities-${id}`)?.value.replace(/,/g, '').trim();
  if (inputVal) tags.push(inputVal);
  return tags.length ? tags.join(',') : null;
}

async function loadRooms() {
  [_allRooms, _allCategories] = await Promise.all([
    api('/api/staff/rooms'),
    api('/api/staff/categories').catch(() => [])
  ]);
  buildCategoryFilter();
  filterRooms($('rooms-category-filter')?.value || '');
}


function buildCategoryFilter() {
  const sel = $('rooms-category-filter');
  const current = sel.value;
  const catSlugs = new Set(_allCategories.map(c => c.slug));
  const extras = [...new Set(_allRooms.map(r => r.type).filter(t => t && !catSlugs.has(t)))];
  sel.innerHTML = '<option value="">Toutes les catégories</option>' +
    _allCategories.map(c => {
      const n = parseDescObj(c.name);
      return `<option value="${escapeHtml(c.slug)}"${c.slug === current ? ' selected' : ''}>${escapeHtml(n.fr || c.slug)}</option>`;
    }).join('') +
    extras.map(t => `<option value="${escapeHtml(t)}"${t === current ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('');
}

function filterRooms(type) {
  const rooms = type ? _allRooms.filter(r => r.type === type) : _allRooms;

  const cards = rooms.map(r => {
    const descObj = parseDescObj(r.description);
    _descCache[r.id] = descObj;
    const title = r.room_number
      ? `<span style="font-size:.8em;opacity:.65;font-weight:400">N°</span> ${r.room_number} &ndash; ${r.name}`
      : r.name;
    return `
    <div class="room-admin-card">
      <h3>${title}</h3>
      <div class="ra-card-layout">
        <div class="ra-card-left">
          <div class="ra-row">
            <div class="ra-field" style="flex:0 0 90px">
              <label for="ra-num-${r.id}">N° chambre</label>
              <input class="ra-input" id="ra-num-${r.id}" value="${escapeHtml(r.room_number||'')}">
            </div>
            <div class="ra-field" style="flex:1;min-width:120px">
              <label for="ra-name-${r.id}">Nom</label>
              <input class="ra-input" id="ra-name-${r.id}" value="${escapeHtml(r.name)}">
            </div>
          </div>
          <div class="ra-row">
            <div class="ra-field" style="flex:1;min-width:130px">
              <label for="ra-type-${r.id}">Catégorie</label>
              <select class="ra-input" id="ra-type-${r.id}">
                ${_allCategories.map(c => {
                  const n = parseDescObj(c.name);
                  return `<option value="${escapeHtml(c.slug)}"${c.slug === r.type ? ' selected' : ''}>${escapeHtml(n.fr || c.slug)}</option>`;
                }).join('')}
                ${!_allCategories.some(c => c.slug === r.type) && r.type ? `<option value="${escapeHtml(r.type)}" selected>${escapeHtml(r.type)}</option>` : ''}
              </select>
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
          <div class="ra-field">
            <label>Équipements</label>
            <div class="ra-tag-input" id="ra-amenities-wrap-${r.id}" onclick="focusTagInput(${r.id})">
              ${(r.amenities||'').split(',').map(a=>a.trim()).filter(Boolean).map(a=>`<span class="ra-tag">${escapeHtml(a)}<button type="button" class="ra-tag-del" onclick="event.stopPropagation();this.closest('.ra-tag').remove()">×</button></span>`).join('')}
              <input class="ra-tag-field" id="ra-amenities-${r.id}" placeholder="Ajouter…" onkeydown="handleTagKey(event,${r.id})" oninput="handleTagInput(event,${r.id})" onblur="handleTagBlur(event,${r.id})">
            </div>
          </div>
          <div class="ra-toggle">
            <input type="checkbox" id="ra-active-${r.id}" ${r.active ? 'checked' : ''}>
            <label for="ra-active-${r.id}">Chambre active</label>
          </div>
          <div class="ra-save">
            <button class="btn-primary" onclick="saveRoom(${r.id})">Enregistrer</button>
          </div>
        </div>
        <div class="ra-card-right">
          <div class="ra-field" style="flex:1;display:flex;flex-direction:column">
            <div class="ra-desc-header">
              <label>Description</label>
              <div class="ra-desc-header-controls">
                <button type="button" class="ra-translate-btn" id="ra-translate-${r.id}" onclick="translateDescAllLangs(${r.id})" title="Traduire depuis la langue sélectionnée vers toutes les autres">🌐 Traduire</button>
                <select class="ra-desc-lang-sel" id="ra-desc-lang-${r.id}" data-prev-lang="fr" onchange="switchDescLang(this,${r.id})">
                  <option value="fr">🇫🇷 FR</option>
                  <option value="en">🇬🇧 EN</option>
                  <option value="de">🇩🇪 DE</option>
                  <option value="es">🇪🇸 ES</option>
                  <option value="it">🇮🇹 IT</option>
                </select>
              </div>
            </div>
            <textarea class="ra-input ra-desc-ta" id="ra-desc-${r.id}" placeholder="Description spécifique à cette chambre…">${escapeHtml(descObj.fr||'')}</textarea>
          </div>
        </div>
      </div>
      <div class="ra-photos-section">
        <div class="ra-photos-section-title">Photos par espace</div>
        ${PHOTO_CATS.map(cat => {
          const catPhotos = (r.photos || []).filter(p => (p.category || 'general') === cat.id);
          return `
          <div class="ra-photo-cat">
            <div class="ra-photo-cat-hdr">
              <span class="ra-photo-cat-label">${cat.icon} ${cat.label}</span>
              <label class="ra-upload-btn ra-upload-sm">+ Photo
                <input type="file" accept="image/*" multiple onchange="uploadRoomPhotos(${r.id}, this, '${cat.id}')" style="display:none">
              </label>
            </div>
            <div class="ra-photos-grid" id="ra-photos-${r.id}-${cat.id}">
              ${catPhotos.length
                ? catPhotos.map(p => photoThumbHTML(r.id, p)).join('')
                : '<span class="ra-no-photos">Aucune photo</span>'}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  const addCard = `
    <div class="room-create-card" onclick="openCreateRoomModal()">
      <span class="plus-icon">+</span>
      <span class="room-create-label">Ajouter une chambre</span>
    </div>`;

  $('rooms-admin-grid').innerHTML = cards + addCard;
}

async function openCreateRoomModal() {
  $('room-create-form').reset();
  _createDescCache = {};
  const langSel = $('nc-desc-lang');
  if (langSel) { langSel.value = 'fr'; langSel.dataset.prevLang = 'fr'; }
  $('nc-error').style.display = 'none';
  if (!_allCategories.length) _allCategories = await api('/api/staff/categories');
  const typeSel = $('nc-type');
  if (typeSel) {
    typeSel.innerHTML = '<option value="">— Choisir —</option>' +
      _allCategories.map(c => {
        const n = parseDescObj(c.name);
        return `<option value="${escapeHtml(c.slug)}">${escapeHtml(n.fr || c.slug)}</option>`;
      }).join('');
  }
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
  const createLangSel = $('nc-desc-lang');
  const createLang = createLangSel ? createLangSel.value : 'fr';
  _createDescCache[createLang] = ($('nc-desc').value || '').trim();
  const createDesc = Object.values(_createDescCache).some(Boolean) ? JSON.stringify(_createDescCache) : null;

  const body = {
    room_number:     ncNum  || null,
    name:            ncName || ncNum || null,
    type:            $('nc-type').value.trim(),
    price_per_night: parseFloat($('nc-price').value),
    capacity:        parseInt($('nc-cap').value),
    description:     createDesc,
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

async function saveRoom(id) {
  const amenities = getTagValues(id);
  const langSel = $(`ra-desc-lang-${id}`);
  const currentLang = langSel ? langSel.value : 'fr';
  if (!_descCache[id]) _descCache[id] = parseDescObj('');
  _descCache[id][currentLang] = $(`ra-desc-${id}`).value;
  const description = JSON.stringify(_descCache[id]);

  const body = {
    room_number:     $(`ra-num-${id}`)?.value || null,
    name:            $(`ra-name-${id}`).value,
    type:            $(`ra-type-${id}`).value.trim(),
    capacity:        parseInt($(`ra-cap-${id}`).value),
    price_per_night: parseFloat($(`ra-price-${id}`).value),
    description,
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
   CATEGORIES
   ════════════════════════════════════════════════════════════════════════════ */

const CAT_LANGS = ['fr','en','de','es','it'];
const CAT_FLAGS = { fr:'🇫🇷', en:'🇬🇧', de:'🇩🇪', es:'🇪🇸', it:'🇮🇹' };

async function loadCategories() {
  _allCategories = await api('/api/staff/categories');
  renderCategories();
}

function renderCategories() {
  const list = $('categories-list');
  if (!_allCategories.length) {
    list.innerHTML = '<p style="color:var(--muted);padding:16px 0">Aucune catégorie. Créez-en une avec le bouton ci-dessus.</p>';
    return;
  }
  list.innerHTML = _allCategories.map(c => categoryCardHTML(c)).join('');
}

function categoryCardHTML(cat) {
  const name = parseDescObj(cat.name);
  const desc = parseDescObj(cat.description);
  const nameRows = CAT_LANGS.map(l => `
    <div class="cat-lang-row">
      <span class="cat-lang-flag">${CAT_FLAGS[l]} ${l.toUpperCase()}</span>
      <input class="ra-input" id="cat-name-${cat.id}-${l}" value="${escapeHtml(name[l]||'')}" placeholder="Nom en ${l}…">
    </div>`).join('');
  const descRows = CAT_LANGS.map(l => `
    <div class="cat-lang-row">
      <span class="cat-lang-flag">${CAT_FLAGS[l]} ${l.toUpperCase()}</span>
      <textarea class="ra-input cat-desc-ta" id="cat-desc-${cat.id}-${l}" placeholder="Description en ${l}…" rows="3">${escapeHtml(desc[l]||'')}</textarea>
    </div>`).join('');
  return `
    <div class="cat-card" id="cat-card-${cat.id}">
      <div class="cat-card-header">
        <div class="cat-fields-row">
          <div class="ra-field" style="flex:1">
            <label>Slug (identifiant unique)</label>
            <input class="ra-input" id="cat-slug-${cat.id}" value="${escapeHtml(cat.slug)}">
          </div>
          <div class="ra-field" style="flex:0 0 80px">
            <label>Ordre</label>
            <input class="ra-input" id="cat-order-${cat.id}" type="number" value="${cat.sort_order||0}">
          </div>
        </div>
      </div>
      <div class="cat-card-body">
        <div class="cat-col">
          <div class="cat-section-label">
            <span>Nom</span>
            <button type="button" class="ra-translate-btn" id="cat-name-transl-${cat.id}" onclick="translateCatField(${cat.id},'name')" title="Traduire le nom FR vers toutes les langues">🌐 Traduire</button>
          </div>
          ${nameRows}
        </div>
        <div class="cat-col">
          <div class="cat-section-label">
            <span>Description</span>
            <button type="button" class="ra-translate-btn" id="cat-desc-transl-${cat.id}" onclick="translateCatField(${cat.id},'desc')" title="Traduire la description FR vers toutes les langues">🌐 Traduire</button>
          </div>
          ${descRows}
        </div>
      </div>
      <div class="cat-card-actions">
        <button class="btn-primary" id="cat-save-${cat.id}" onclick="saveCategory(${cat.id})">Enregistrer</button>
        <button class="btn-danger"  onclick="deleteCategory(${cat.id})">Supprimer</button>
      </div>
    </div>`;
}

async function translateCatField(id, field) {
  const frEl = field === 'name' ? $(`cat-name-${id}-fr`) : $(`cat-desc-${id}-fr`);
  const frText = frEl ? frEl.value.trim() : '';
  if (!frText) return;
  const btn = $(`cat-${field}-transl-${id}`);
  if (btn) { btn.disabled = true; btn.className = 'ra-translate-btn loading'; btn.textContent = '⏳'; }
  let errors = 0;
  await Promise.all(['en','de','es','it'].map(async tgt => {
    try {
      const translated = await _callMyMemory(frText, 'fr', tgt);
      const el = field === 'name' ? $(`cat-name-${id}-${tgt}`) : $(`cat-desc-${id}-${tgt}`);
      if (el) el.value = translated;
    } catch(e) { errors++; }
  }));
  if (btn) {
    btn.disabled = false;
    btn.className = `ra-translate-btn ${errors ? 'error' : 'success'}`;
    btn.textContent = errors ? '⚠ Partiel' : '✓ Traduit';
    setTimeout(() => { btn.className = 'ra-translate-btn'; btn.textContent = '🌐 Traduire'; }, 2200);
  }
}

async function saveCategory(id) {
  const slug = $(`cat-slug-${id}`)?.value.trim();
  if (!slug) { alert('Le slug est requis'); return; }
  const name = {}, desc = {};
  CAT_LANGS.forEach(l => {
    name[l] = $(`cat-name-${id}-${l}`)?.value.trim() || '';
    desc[l]  = $(`cat-desc-${id}-${l}`)?.value.trim() || '';
  });
  const body = { slug, name, description: desc, sort_order: parseInt($(`cat-order-${id}`)?.value) || 0 };
  const btn = $(`cat-save-${id}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    await api(`/api/staff/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    const idx = _allCategories.findIndex(c => c.id === id);
    if (idx >= 0) _allCategories[idx] = { ..._allCategories[idx], slug, name: JSON.stringify(name), description: JSON.stringify(desc), sort_order: body.sort_order };
    if (btn) { btn.textContent = '✓ Sauvegardé'; }
    setTimeout(() => { if (btn) { btn.textContent = 'Enregistrer'; btn.disabled = false; } }, 1800);
  } catch(e) {
    alert(`Erreur : ${e.message}`);
    if (btn) { btn.textContent = 'Enregistrer'; btn.disabled = false; }
  }
}

async function deleteCategory(id) {
  if (!confirm('Supprimer cette catégorie ?')) return;
  try {
    await api(`/api/staff/categories/${id}`, { method: 'DELETE' });
    _allCategories = _allCategories.filter(c => c.id !== id);
    renderCategories();
  } catch(e) { alert(`Erreur : ${e.message}`); }
}

function openNewCategoryCard() {
  const list = $('categories-list');
  if ($('cat-card-new')) return;
  const div = document.createElement('div');
  div.id = 'cat-card-new';
  div.className = 'cat-card cat-card-creating';
  div.innerHTML = `
    <div class="ra-field" style="margin-bottom:12px">
      <label>Nom de la catégorie (FR) *</label>
      <input class="ra-input" id="cat-new-name" placeholder="ex : Suite Junior" autofocus>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn-primary" onclick="createCategory()">Créer</button>
      <button class="btn-ghost" onclick="this.closest('#cat-card-new').remove()">Annuler</button>
    </div>`;
  list.prepend(div);
  setTimeout(() => $('cat-new-name')?.focus(), 50);
}

async function createCategory() {
  const frName = $('cat-new-name')?.value.trim();
  if (!frName) return;
  const slug = frName.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const name = { fr: frName, en: '', de: '', es: '', it: '' };
  try {
    const r = await api('/api/staff/categories', { method: 'POST', body: JSON.stringify({ slug, name, description: {}, sort_order: _allCategories.length }) });
    _allCategories = await api('/api/staff/categories');
    renderCategories();
    setTimeout(() => { const card = $(`cat-card-${r.id}`); if (card) card.scrollIntoView({ behavior: 'smooth' }); }, 80);
  } catch(e) { alert(`Erreur : ${e.message}`); }
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
}

async function loadHousekeeping() {
  const date  = $('hk-date').value;
  await api('/api/staff/housekeeping/generate', { method: 'POST', body: JSON.stringify({ date }) }).catch(() => {});
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
  const from    = localISO(days[0]);
  const to      = localISO(days[6]);
  planShifts    = await api(`/api/staff/shifts?from=${from}&to=${to}`);

  const todayStr = todayISO();
  const weekLabel = `${days[0].toLocaleDateString('fr-FR',{day:'numeric',month:'long'})} — ${days[6].toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}`;
  $('plan-week-label').textContent  = weekLabel;
  $('plan-print-range').textContent = `Semaine du ${weekLabel}`;

  const DAY_FR = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

  let html = `<div class="plan-header-row">
    <div class="plan-emp-col">Employé</div>
    ${days.map((d,i) => {
      const iso = localISO(d);
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
        const iso     = localISO(d);
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
  // Direction
  directeur:             'Directeur général',
  directeur_adjoint:     'Directeur adjoint',
  // Hébergement
  gouvernante:           'Gouvernante d\'étage',
  femme_de_chambre:      'Femme / Valet de chambre',
  lingere:               'Lingère',
  // Réception & Accueil
  chef_reception:        'Chef de réception',
  receptionniste:        'Réceptionniste',
  concierge:             'Concierge',
  bagagiste:             'Bagagiste / Groom',
  night_auditor:         'Night Auditor',
  // Restauration
  chef_cuisine:          'Chef de cuisine',
  cuisinier:             'Cuisinier / Commis',
  serveur:               'Serveur / Serveuse',
  barman:                'Barman / Barmaid',
  sommelier:             'Sommelier',
  responsable_fb:        'Responsable F&B',
  // Technique
  responsable_technique: 'Responsable technique',
  maintenance:           'Agent de maintenance',
  // Spa
  spa:                   'Praticien(ne) Spa',
  // Sécurité
  securite:              'Agent de sécurité',
  // Administratif
  comptable:             'Comptable',
  revenue_manager:       'Revenue Manager',
  responsable_commercial:'Responsable commercial',
  responsable:           'Responsable / Manager',
  // Autres
  extras:                'Extras / Saisonnier',
  stagiaire:             'Stagiaire',
};

const ROLE_COLORS = {
  directeur: '#7c3aed', directeur_adjoint: '#7c3aed',
  gouvernante: '#0369a1', femme_de_chambre: '#0369a1', lingere: '#0369a1',
  chef_reception: '#0f766e', receptionniste: '#0f766e', concierge: '#0f766e', bagagiste: '#0f766e', night_auditor: '#0f766e',
  chef_cuisine: '#b45309', cuisinier: '#b45309', serveur: '#b45309', barman: '#b45309', sommelier: '#b45309', responsable_fb: '#b45309',
  responsable_technique: '#374151', maintenance: '#374151',
  spa: '#be185d',
  securite: '#dc2626',
  comptable: '#1d4ed8', revenue_manager: '#1d4ed8', responsable_commercial: '#1d4ed8', responsable: '#1d4ed8',
  extras: '#6b7280', stagiaire: '#6b7280',
};

async function loadPersonnel() {
  const roleFilter   = $('emp-filter-role').value;
  const activeFilter = $('emp-filter-active').value;
  let emps = await api('/api/staff/employees');
  if (roleFilter)   emps = emps.filter(e => e.role === roleFilter);
  if (activeFilter !== '') emps = emps.filter(e => String(e.active) === activeFilter);
  const grid = $('employees-grid');
  if (!emps.length) { grid.innerHTML = `<p class="empty-msg">Aucun employé pour ces critères.</p>`; return; }
  grid.innerHTML = emps.map(e => {
    const initials  = (e.first_name[0] + e.last_name[0]).toUpperCase();
    const roleLabel = ROLE_LABELS[e.role] || e.role;
    const roleColor = ROLE_COLORS[e.role] || '#2d6a4f';
    return `
    <div class="emp-card${e.active ? '' : ' inactive'}">
      <div class="emp-card-top">
        <div class="emp-avatar" style="background:${e.color}">${initials}</div>
        <div class="emp-info">
          <h3>${e.first_name} ${e.last_name}</h3>
          <span class="emp-role-badge" style="background:${roleColor}18;color:${roleColor}">${roleLabel}</span>
          ${!e.active ? `<span class="emp-inactive-badge">Inactif</span>` : ''}
        </div>
      </div>
      <div class="emp-card-details">
        ${e.phone ? `<span>📞 ${e.phone}</span>` : ''}
        ${e.email ? `<span>✉️ ${e.email}</span>` : ''}
        ${e.notes ? `<span>📝 ${e.notes}</span>` : ''}
      </div>
      <div class="emp-card-actions">
        <button class="btn-secondary" style="flex:1" onclick="openEmployeeModal(${e.id})">Modifier la fiche</button>
      </div>
    </div>`;
  }).join('');
}

$('add-employee-btn').onclick   = () => openEmployeeModal(null);
$('emp-filter-role').onchange   = loadPersonnel;
$('emp-filter-active').onchange = loadPersonnel;

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

/* ── Livre d'or (Reviews) ───────────────────────────────────────────────────── */
async function loadReviews() {
  const filter = $('reviews-filter').value;
  const grid   = $('reviews-grid');
  grid.innerHTML = '<div class="loading-msg">Chargement…</div>';
  try {
    const reviews = await api(`/api/staff/reviews${filter ? `?status=${filter}` : ''}`);
    if (!reviews.length) {
      grid.innerHTML = '<div class="empty-msg">Aucun avis pour le moment.</div>';
      return;
    }
    grid.innerHTML = reviews.map(reviewCardHTML).join('');
  } catch (err) {
    grid.innerHTML = `<div class="empty-msg">Erreur : ${err.message}</div>`;
  }
}

function reviewCardHTML(r) {
  const stars = Array.from({ length: 5 }, (_, i) =>
    `<span class="rv-star ${i < r.rating ? 'filled' : ''}">${i < r.rating ? '★' : '☆'}</span>`
  ).join('');
  const date    = new Date(r.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const source  = r.source === 'kiosk' ? '<span class="badge badge-staff">Kiosk</span>' : '<span class="badge badge-website">QR</span>';
  const consent = r.consent ? '<span class="rv-consent" title="Accepte la publication">✓ pub.</span>' : '';
  const statusBadge = r.approved
    ? '<span class="badge badge-confirmed">Approuvé</span>'
    : '<span class="badge badge-pending">En attente</span>';

  return `<div class="rv-card" data-id="${r.id}">
    <div class="rv-card-header">
      <div class="rv-card-meta">
        <strong class="rv-name">${escapeHtml(r.name)}</strong>
        <div class="rv-stars">${stars}</div>
      </div>
      <div class="rv-card-badges">${statusBadge} ${source} ${consent}</div>
    </div>
    <p class="rv-comment">${escapeHtml(r.comment)}</p>
    <div class="rv-card-footer">
      <span class="rv-date">${date}</span>
      <div class="rv-actions">
        ${r.approved
          ? `<button class="btn-secondary btn-sm" onclick="setApproved(${r.id}, false)">Désapprouver</button>`
          : `<button class="btn-primary  btn-sm" onclick="setApproved(${r.id}, true)">Approuver</button>`
        }
        <button class="btn-delete btn-sm" onclick="deleteReview(${r.id})">Supprimer</button>
      </div>
    </div>
  </div>`;
}

async function setApproved(id, approved) {
  try {
    await api(`/api/staff/reviews/${id}`, { method: 'PATCH', body: JSON.stringify({ approved }) });
    loadReviews();
  } catch (err) { alert(`Erreur : ${err.message}`); }
}

async function deleteReview(id) {
  if (!confirm('Supprimer cet avis définitivement ?')) return;
  try {
    await api(`/api/staff/reviews/${id}`, { method: 'DELETE' });
    loadReviews();
  } catch (err) { alert(`Erreur : ${err.message}`); }
}

$('reviews-filter').addEventListener('change', loadReviews);
