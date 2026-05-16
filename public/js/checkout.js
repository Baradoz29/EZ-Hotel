/* ── Checkout page ──────────────────────────────────────────────────────────── */

const fmt = iso => iso
  ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  : '';

const fmtShort = iso => iso
  ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  : '';

const $ = id => document.getElementById(id);

/* ── Session data ────────────────────────────────────────────────────────────*/
const raw = sessionStorage.getItem('gk_checkout');
if (!raw) {
  $('ck-layout').hidden = true;
  $('ck-empty').hidden = false;
  throw new Error('No checkout data');
}
const data = JSON.parse(raw);

/* ── State ───────────────────────────────────────────────────────────────────*/
const BREAKFAST_PRICE = 20;
let bkfEnabled    = false;
let paymentMode   = 'online';   // 'online' | 'on_arrival'
let stripeInst    = null;
let stripeElems   = null;
let currentTotal  = 0;

/* ── Helpers ─────────────────────────────────────────────────────────────────*/
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function computeTotal() {
  const bkf = bkfEnabled ? BREAKFAST_PRICE * data.num_guests * data.nights : 0;
  return data.price_per_night * data.nights + bkf;
}

/* ── Payment mode selector ───────────────────────────────────────────────────*/
document.querySelectorAll('input[name="pay_mode"]').forEach(radio => {
  radio.addEventListener('change', e => {
    paymentMode = e.target.value;
    $('ck-card-online').classList.toggle('ck-pay-mode-selected', paymentMode === 'online');
    $('ck-card-arrival').classList.toggle('ck-pay-mode-selected', paymentMode === 'on_arrival');
    updatePricing();
    syncPayBtn();
  });
});

function syncPayBtn() {
  if (!stripeInst) return;
  $('ck-pay-btn').textContent =
    paymentMode === 'on_arrival' ? 'Garantir par carte' : 'Passer au paiement';
}

/* ── Pricing ─────────────────────────────────────────────────────────────────*/
function updatePricing() {
  const roomTotal = data.price_per_night * data.nights;
  const bkfTotal  = bkfEnabled ? BREAKFAST_PRICE * data.num_guests * data.nights : 0;
  currentTotal    = roomTotal + bkfTotal;

  let lines = `
    <div class="ck-price-line">
      <span>${esc(data.room_name || 'Chambre')} × ${data.nights} nuit${data.nights > 1 ? 's' : ''}</span>
      <span>${roomTotal.toFixed(0)} €</span>
    </div>`;

  if (bkfEnabled) {
    lines += `
    <div class="ck-price-line ck-price-line-extra">
      <span>Petit-déjeuner × ${data.num_guests} pers. × ${data.nights} nuit${data.nights > 1 ? 's' : ''}</span>
      <span>${bkfTotal.toFixed(0)} €</span>
    </div>`;
  }

  $('ck-price-lines').innerHTML = lines;
  $('ck-total').textContent = `${currentTotal.toFixed(0)} €`;

  const noteEl = $('ck-guarantee-note');
  if (paymentMode === 'on_arrival') {
    const guarantee = data.price_per_night;
    const onSite    = currentTotal - guarantee;
    noteEl.innerHTML = onSite > 0
      ? `Aujourd'hui : <strong>${guarantee.toFixed(0)} € préautorisés</strong> (non débités) · À l'arrivée : <strong>${onSite.toFixed(0)} €</strong>`
      : `Aujourd'hui : <strong>${guarantee.toFixed(0)} € préautorisés</strong> (non débités) · Rien à régler sur place`;
    noteEl.hidden = false;
  } else {
    noteEl.hidden = true;
  }

  $('ck-bkf-price').textContent = `+${(BREAKFAST_PRICE * data.num_guests * data.nights).toFixed(0)} €`;

  // Mode amount labels
  $('ck-online-amount').textContent  = `Total débité : ${currentTotal.toFixed(0)} €`;
  $('ck-arrival-amount').textContent = `Garantie : ${data.price_per_night.toFixed(0)} € · Solde ${(currentTotal - data.price_per_night).toFixed(0)} € sur place`;

  $('ck-pay-amount').textContent =
    paymentMode === 'on_arrival'
      ? `${data.price_per_night.toFixed(0)} € (garantie)`
      : `${currentTotal.toFixed(0)} €`;
}

/* ── Breakfast toggle ────────────────────────────────────────────────────────*/
$('ck-breakfast').addEventListener('change', e => {
  bkfEnabled = e.target.checked;
  updatePricing();
});

/* ── Room photo ──────────────────────────────────────────────────────────────*/
async function loadRoomPhoto() {
  try {
    const res  = await fetch(`/api/rooms/${data.room_id}`);
    if (!res.ok) return;
    const room = await res.json();
    const chambrePhotos = room.photos.filter(p => (p.category || 'general') === 'chambre');
    const photo = chambrePhotos[0] || room.photos[0];
    if (photo)
      $('ck-room-img').innerHTML = `<img src="/assets/images/rooms/${room.id}/${photo.filename}" alt="">`;
  } catch(e) {}
}

/* ── Populate ────────────────────────────────────────────────────────────────*/
function populate() {
  $('ck-room-name').textContent   = data.room_name || `Chambre ${data.room_number || data.room_id}`;
  $('ck-room-dates').textContent  = `${fmtShort(data.check_in)} → ${fmtShort(data.check_out)} · ${data.nights} nuit${data.nights > 1 ? 's' : ''}`;
  $('ck-room-guests').textContent = `👤 ${data.num_guests} voyageur${data.num_guests > 1 ? 's' : ''}`;
  $('ck-room-price').textContent  = `${data.price_per_night} € / nuit`;

  $('ck-guest-recap').innerHTML = `
    <div class="ck-guest-line"><span>Nom</span><strong>${esc(data.guest_name)}</strong></div>
    <div class="ck-guest-line"><span>E-mail</span><strong>${esc(data.guest_email)}</strong></div>
    ${data.guest_phone ? `<div class="ck-guest-line"><span>Téléphone</span><strong>${esc(data.guest_phone)}</strong></div>` : ''}
    ${data.notes ? `<div class="ck-guest-line"><span>Notes</span><strong>${esc(data.notes)}</strong></div>` : ''}`;

  updatePricing();
  loadRoomPhoto();
  $('ck-pay-btn').disabled = false;
}

/* ── Init Stripe ─────────────────────────────────────────────────────────────*/
async function initStripe() {
  try {
    const cfg = await fetch('/api/stripe-config').then(r => r.json());
    if (!cfg.publishableKey || cfg.publishableKey.includes('VOTRE_CLE')) return null;
    return Stripe(cfg.publishableKey);
  } catch(e) { return null; }
}

/* ── Open payment modal ──────────────────────────────────────────────────────*/
async function openPaymentModal() {
  const btn = $('ck-pay-btn');
  btn.disabled = true;
  btn.textContent = 'Préparation…';

  if (!stripeInst) {
    await finalizeBooking(null);
    btn.disabled = false;
    syncPayBtn();
    return;
  }

  try {
    const total           = computeTotal();
    const isOnArrival     = paymentMode === 'on_arrival';
    const stripeAmount    = isOnArrival ? data.price_per_night : total;

    const resp = await fetch('/api/checkout/create-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount:              total,
        first_night_amount:  data.price_per_night,
        payment_mode:        paymentMode,
        metadata: {
          room_id:    String(data.room_id),
          guest_name: data.guest_name,
          guest_email: data.guest_email,
          check_in:   data.check_in,
          check_out:  data.check_out,
        },
      }),
    });
    const { clientSecret, error } = await resp.json();
    if (error) throw new Error(error);

    // Mount Payment Element
    stripeElems = stripeInst.elements({ clientSecret, locale: 'fr' });
    const pe = stripeElems.create('payment');
    $('payment-element').innerHTML = '';
    pe.mount('#payment-element');
    pe.on('ready', () => { $('ck-stripe-pay-btn').disabled = false; });

    // Modal recap
    const bkfTotal = bkfEnabled ? BREAKFAST_PRICE * data.num_guests * data.nights : 0;
    $('ck-payment-recap').innerHTML = `
      <div class="ck-payment-recap-line">
        <span>${esc(data.room_name || 'Chambre')}</span>
        <span>${(data.price_per_night * data.nights).toFixed(0)} €</span>
      </div>
      ${bkfEnabled ? `<div class="ck-payment-recap-line">
        <span>Petit-déjeuner</span>
        <span>${bkfTotal.toFixed(0)} €</span>
      </div>` : ''}
      ${isOnArrival ? `<div class="ck-payment-recap-note">
        💡 Seule la 1ère nuit (${data.price_per_night.toFixed(0)} €) est préautorisée — non débitée. Solde réglé à l'arrivée.
      </div>` : ''}
      <div class="ck-payment-recap-total">
        <span>${isOnArrival ? 'Garantie préautorisée' : 'Total débité'}</span>
        <span>${stripeAmount.toFixed(0)} €</span>
      </div>`;

    $('ck-pay-amount').textContent =
      isOnArrival ? `${data.price_per_night.toFixed(0)} € (garantie)` : `${total.toFixed(0)} €`;
    $('payment-message').hidden = true;
    $('ck-payment-overlay').hidden = false;
    document.body.style.overflow = 'hidden';
  } catch(err) {
    alert(`Erreur : ${err.message}`);
  } finally {
    btn.disabled = false;
    syncPayBtn();
  }
}

/* ── Close payment modal ─────────────────────────────────────────────────────*/
function closePaymentModal() {
  $('ck-payment-overlay').hidden = true;
  document.body.style.overflow = '';
}

$('ck-payment-close').addEventListener('click', closePaymentModal);
$('ck-payment-overlay').addEventListener('click', e => {
  if (e.target === $('ck-payment-overlay')) closePaymentModal();
});

/* ── Stripe submit ───────────────────────────────────────────────────────────*/
$('ck-stripe-pay-btn').addEventListener('click', async () => {
  const btn = $('ck-stripe-pay-btn');
  btn.disabled = true;
  btn.textContent = 'Traitement…';
  $('payment-message').hidden = true;

  const { error, paymentIntent } = await stripeInst.confirmPayment({
    elements: stripeElems,
    confirmParams: {
      return_url: window.location.origin + '/checkout',
      payment_method_data: {
        billing_details: { name: data.guest_name, email: data.guest_email },
      },
    },
    redirect: 'if_required',
  });

  if (error) {
    $('payment-message').textContent = error.message;
    $('payment-message').hidden = false;
    btn.disabled = false;
    btn.innerHTML = `Payer <span id="ck-pay-amount">${$('ck-pay-amount')?.textContent || ''}</span>`;
    return;
  }

  // online → 'succeeded' | on_arrival → 'requires_capture'
  if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'requires_capture')) {
    closePaymentModal();
    await finalizeBooking(paymentIntent.id);
  }
});

/* ── Main pay button ─────────────────────────────────────────────────────────*/
$('ck-pay-btn').addEventListener('click', openPaymentModal);

/* ── Finalize ────────────────────────────────────────────────────────────────*/
async function finalizeBooking(paymentIntentId) {
  const body = {
    room_id:           data.room_id,
    guest_name:        data.guest_name,
    guest_email:       data.guest_email,
    guest_phone:       data.guest_phone || null,
    check_in:          data.check_in,
    check_out:         data.check_out,
    num_guests:        data.num_guests,
    notes:             data.notes || null,
    breakfast:         bkfEnabled ? 1 : 0,
    arrival_time:      $('ck-arrival').value || null,
    payment_mode:      paymentMode,
    payment_intent_id: paymentIntentId,
  };

  try {
    const res    = await fetch('/api/checkout/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    sessionStorage.removeItem('gk_checkout');
    showConfirmation(result, body);
  } catch(err) {
    alert(`Erreur de finalisation : ${err.message}`);
  }
}

/* ── Confirmation overlay ────────────────────────────────────────────────────*/
function showConfirmation(result, body) {
  const arrLine = body.arrival_time
    ? `<div class="ck-conf-line"><span>Heure d'arrivée</span><strong>${body.arrival_time}</strong></div>` : '';
  const bkfLine = body.breakfast
    ? `<div class="ck-conf-line"><span>Petit-déjeuner</span><strong>Inclus</strong></div>` : '';
  const payLine = result.payment_mode === 'on_arrival'
    ? `<div class="ck-conf-line"><span>Paiement</span><strong>Garantie carte · Solde sur place</strong></div>`
    : `<div class="ck-conf-line"><span>Paiement</span><strong>Réglé en ligne ✓</strong></div>`;

  $('ck-confirm-details').innerHTML = `
    <div class="ck-conf-num">Réservation N° <strong>${result.id}</strong></div>
    <div class="ck-conf-line"><span>Chambre</span><strong>${esc(result.room_name || data.room_name)}</strong></div>
    <div class="ck-conf-line"><span>Séjour</span><strong>${fmtShort(data.check_in)} → ${fmtShort(data.check_out)} · ${result.nights} nuit${result.nights > 1 ? 's' : ''}</strong></div>
    <div class="ck-conf-line"><span>Voyageurs</span><strong>${data.num_guests}</strong></div>
    ${bkfLine}${arrLine}${payLine}
    <div class="ck-conf-line"><span>Voyageur</span><strong>${esc(data.guest_name)}</strong></div>
    <div class="ck-conf-line"><span>E-mail</span><strong>${esc(data.guest_email)}</strong></div>
    <div class="ck-conf-total"><span>Total séjour</span><strong>${result.total_price.toFixed(2)} €</strong></div>
    <p class="ck-conf-note">Un e-mail de confirmation vous sera envoyé à ${esc(data.guest_email)}.</p>`;

  $('ck-confirm-overlay').hidden = false;
  document.body.style.overflow = 'hidden';
}

/* ── Stripe redirect return (3DS) ────────────────────────────────────────────*/
async function handleStripeReturn() {
  const params   = new URLSearchParams(location.search);
  const piSecret = params.get('payment_intent_client_secret');
  const piId     = params.get('payment_intent');
  if (!piSecret || !piId || !stripeInst) return;

  history.replaceState({}, '', '/checkout');
  const { paymentIntent, error } = await stripeInst.retrievePaymentIntent(piSecret);

  if (error || !paymentIntent ||
      (paymentIntent.status !== 'succeeded' && paymentIntent.status !== 'requires_capture')) {
    alert('Le paiement a échoué. Veuillez réessayer.');
    return;
  }

  $('ck-layout').hidden = true;
  await finalizeBooking(paymentIntent.id);
}

/* ── Init ────────────────────────────────────────────────────────────────────*/
async function init() {
  stripeInst = await initStripe();

  if (!stripeInst) {
    // Hide payment mode section — no Stripe, pay on arrival by default
    $('ck-pay-mode-section').hidden = true;
    $('ck-pay-btn').textContent     = 'Confirmer la réservation';
    $('ck-secure-note').textContent = '🔒 Confirmation gratuite · Paiement à l\'arrivée';
    paymentMode = 'on_arrival';
  }

  populate();

  if (new URLSearchParams(location.search).has('payment_intent')) {
    await handleStripeReturn();
  }
}

init();
