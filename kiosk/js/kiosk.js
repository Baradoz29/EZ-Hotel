/* ── Leaf animation ──────────────────────────────────────────────────────── */
(function initLeaves() {
  const layer  = document.getElementById('leaves-layer');
  const STEPS  = 20;
  const HEIGHT = window.innerHeight + 100;

  for (let i = 0; i < 18; i++) {
    const size    = 40 + Math.random() * 50;
    const left    = Math.random() * 106 - 3;
    const dur     = 11 + Math.random() * 10;
    const del     = -(Math.random() * dur);
    const amp     = 40 + Math.random() * 50;
    const freq    = 0.35 + Math.random() * 0.4;
    const phase   = Math.random() * Math.PI * 2;
    const op      = (0.45 + Math.random() * 0.4).toFixed(2);
    const baseRot = -45 + Math.random() * 180;
    const tiltAmp = 30 + Math.random() * 40;
    const dragBias = (Math.random() * 12 - 6);

    const name = `kl${i}`;
    let kf = `@keyframes ${name}{`;
    for (let s = 0; s <= STEPS; s++) {
      const t   = s / STEPS;
      const pct = (t * 100).toFixed(1);
      const y   = (HEIGHT * t).toFixed(1);
      const x   = (amp * Math.sin(2 * Math.PI * freq * t + phase)).toFixed(2);
      const r   = (baseRot + dragBias + tiltAmp * Math.cos(2 * Math.PI * freq * t + phase)).toFixed(2);
      const fadezero = s === 0          ? 'opacity:0;'     : '';
      const fadein   = s === 1          ? `opacity:${op};` : '';
      const fadeout  = s === STEPS - 1  ? `opacity:${op};` : '';
      const fadeend  = s === STEPS      ? 'opacity:0;'     : '';
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

/* ── QR code avec logo ───────────────────────────────────────────────────── */
(async function initQR() {
  try {
    const res  = await fetch('/api/qr');
    const data = await res.json();
    document.getElementById('qr-img').src = data.dataUrl;
  } catch (e) {
    console.error('QR error', e);
  }
})();

/* ── Star rating ─────────────────────────────────────────────────────────── */
function initStars(containerId, inputId) {
  const container = document.getElementById(containerId);
  const input     = document.getElementById(inputId);
  let current = 0;

  container.querySelectorAll('.star').forEach(btn => {
    btn.addEventListener('mouseenter', () => highlightStars(container, +btn.dataset.v));
    btn.addEventListener('mouseleave', () => highlightStars(container, current));
    btn.addEventListener('click', () => {
      current = +btn.dataset.v;
      input.value = current;
      highlightStars(container, current);
    });
  });
}

function highlightStars(container, value) {
  container.querySelectorAll('.star').forEach(s => {
    s.classList.toggle('active', +s.dataset.v <= value);
  });
}

initStars('k-stars', 'k-rating');

/* ── Modal ───────────────────────────────────────────────────────────────── */
const modal     = document.getElementById('kiosk-modal');
const form      = document.getElementById('kiosk-form');
const successEl = document.getElementById('k-success');
const errorEl   = document.getElementById('k-error');

document.getElementById('open-form-btn').addEventListener('click', () => {
  modal.hidden = false;
});

document.getElementById('modal-close-btn').addEventListener('click', closeModal);

modal.addEventListener('click', e => {
  if (e.target === modal) closeModal();
});

function closeModal() {
  modal.hidden = true;
  resetForm();
}

function resetForm() {
  form.reset();
  form.hidden = false;
  successEl.hidden = true;
  errorEl.hidden = true;
  document.getElementById('k-rating').value = '';
  highlightStars(document.getElementById('k-stars'), 0);
}

/* ── Form submit ─────────────────────────────────────────────────────────── */
form.addEventListener('submit', async e => {
  e.preventDefault();
  errorEl.hidden = true;

  const name    = document.getElementById('k-name').value.trim();
  const rating  = document.getElementById('k-rating').value;
  const comment = document.getElementById('k-comment').value.trim();
  const consent = document.getElementById('k-consent').checked;

  if (!rating) {
    errorEl.textContent = 'Veuillez sélectionner une note.';
    errorEl.hidden = false;
    return;
  }

  const btn = document.getElementById('k-submit');
  btn.disabled = true;
  btn.textContent = 'Envoi…';

  try {
    await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, rating: +rating, comment, consent, source: 'kiosk' })
    }).then(r => { if (!r.ok) throw new Error(); return r.json(); });

    form.hidden = true;
    successEl.hidden = false;

    let count = 5;
    document.getElementById('k-countdown').textContent = count;
    const timer = setInterval(() => {
      count--;
      document.getElementById('k-countdown').textContent = count;
      if (count <= 0) {
        clearInterval(timer);
        closeModal();
      }
    }, 1000);

  } catch {
    errorEl.textContent = 'Une erreur est survenue. Veuillez réessayer.';
    errorEl.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Envoyer';
  }
});
