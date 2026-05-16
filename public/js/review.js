/* ── Star rating ─────────────────────────────────────────────────────────── */
const starsContainer = document.getElementById('rv-stars');
const ratingInput    = document.getElementById('rv-rating');
let currentRating = 0;

starsContainer.querySelectorAll('.star').forEach(btn => {
  btn.addEventListener('mouseenter', () => highlight(+btn.dataset.v));
  btn.addEventListener('mouseleave', () => highlight(currentRating));
  btn.addEventListener('click', () => {
    currentRating = +btn.dataset.v;
    ratingInput.value = currentRating;
    highlight(currentRating);
  });
});

function highlight(value) {
  starsContainer.querySelectorAll('.star').forEach(s => {
    s.classList.toggle('active', +s.dataset.v <= value);
  });
}

/* ── Char counter ────────────────────────────────────────────────────────── */
const commentTA = document.getElementById('rv-comment');
const charSpan  = document.getElementById('rv-char');
commentTA.addEventListener('input', () => { charSpan.textContent = commentTA.value.length; });

/* ── Form submit ─────────────────────────────────────────────────────────── */
document.getElementById('review-form').addEventListener('submit', async e => {
  e.preventDefault();
  const errorEl = document.getElementById('rv-error');
  errorEl.hidden = true;

  const name    = document.getElementById('rv-name').value.trim();
  const rating  = ratingInput.value;
  const comment = commentTA.value.trim();
  const consent = document.getElementById('rv-consent').checked;

  if (!rating) {
    errorEl.textContent = 'Veuillez sélectionner une note en cliquant sur les étoiles.';
    errorEl.hidden = false;
    return;
  }

  const btn = document.getElementById('rv-submit');
  btn.disabled = true;
  btn.textContent = 'Envoi en cours…';

  try {
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, rating: +rating, comment, consent, source: 'qr' })
    });
    if (!res.ok) throw new Error();
    document.getElementById('rv-form-card').hidden  = true;
    document.getElementById('rv-success-card').hidden = false;
  } catch {
    errorEl.textContent = 'Une erreur est survenue. Veuillez réessayer.';
    errorEl.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Envoyer mon avis';
  }
});
