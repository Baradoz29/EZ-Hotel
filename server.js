require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const Stripe = require('stripe');
const db = require('./database');

const stripeClient = (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('VOTRE_CLE'))
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendConfirmationEmail(reservation) {
  if (!process.env.SMTP_USER || process.env.SMTP_USER === 'votre-email@gmail.com') return;
  const fmtDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const bkfLine = reservation.breakfast
    ? `<p>☕ Petit-déjeuner inclus · ${reservation.breakfast_price?.toFixed(2)} €</p>` : '';
  const arrLine = reservation.arrival_time
    ? `<p>🕐 Heure d'arrivée prévue : ${reservation.arrival_time}</p>` : '';

  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:auto;color:#1a1a1a">
  <div style="background:#1b4332;color:#fff;padding:24px 32px;border-radius:12px 12px 0 0">
    <h1 style="margin:0;font-size:1.4rem">Hôtel Ginkgo ★★★★</h1>
    <p style="margin:4px 0 0;opacity:.8">Confirmation de réservation</p>
  </div>
  <div style="padding:24px 32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <p>Bonjour <strong>${reservation.guest_name}</strong>,</p>
    <p>Votre réservation est confirmée. Nous avons hâte de vous accueillir !</p>
    <div style="background:#f0faf4;border-radius:8px;padding:16px 20px;margin:20px 0">
      <p style="margin:0 0 8px;font-weight:700;color:#2d6a4f">N° ${reservation.id} · ${reservation.room_name}</p>
      <p style="margin:4px 0">📅 ${fmtDate(reservation.check_in)} → ${fmtDate(reservation.check_out)} · ${reservation.nights} nuit${reservation.nights > 1 ? 's' : ''}</p>
      <p style="margin:4px 0">👤 ${reservation.num_guests} voyageur${reservation.num_guests > 1 ? 's' : ''}</p>
      ${bkfLine}${arrLine}
      <p style="margin:12px 0 0;font-weight:700;font-size:1.1rem">Total : ${reservation.total_price.toFixed(2)} €</p>
    </div>
    <p style="font-size:.85rem;color:#6b7280">Paiement à l'arrivée. Annulation gratuite jusqu'à 48h avant l'arrivée.</p>
    <p style="font-size:.85rem;color:#6b7280">Une question ? Écrivez-nous à <a href="mailto:${process.env.HOTEL_EMAIL}" style="color:#2d6a4f">${process.env.HOTEL_EMAIL}</a></p>
    <p style="margin-top:24px">À très bientôt,<br><strong>L'équipe Hôtel Ginkgo</strong></p>
  </div>
</div>`;

  try {
    await mailer.sendMail({
      from: `"${process.env.HOTEL_NAME || 'Hôtel Ginkgo'}" <${process.env.SMTP_USER}>`,
      to: reservation.guest_email,
      bcc: process.env.HOTEL_EMAIL,
      subject: `Confirmation réservation N°${reservation.id} — Hôtel Ginkgo`,
      html,
    });
  } catch(e) {
    console.warn('Email non envoyé :', e.message);
  }
}

const app = express();
const PORT = parseInt(process.env.PORT) || 3000;

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public', 'assets', 'images', 'rooms', String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const uploadPhoto = multer({
  storage: photoStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype))
});

function attachPhotos(rooms) {
  const photos = db.prepare('SELECT * FROM room_photos ORDER BY sort_order, id').all();
  const byRoom = {};
  for (const p of photos) {
    if (!byRoom[p.room_id]) byRoom[p.room_id] = [];
    byRoom[p.room_id].push(p);
  }
  return rooms.map(r => ({ ...r, photos: byRoom[r.id] || [] }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/staff', express.static(path.join(__dirname, 'staff')));

app.use(session({
  store: new SqliteStore({ db: 'sessions.db', dir: __dirname }),
  secret: 'ginkgo-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

function requireStaff(req, res, next) {
  if (req.session && req.session.staffId) return next();
  res.status(401).json({ error: 'Non autorisé' });
}

// ── STRIPE ────────────────────────────────────────────────────────────────────

app.get('/api/stripe-config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '' });
});

app.post('/api/checkout/create-intent', async (req, res) => {
  if (!stripeClient) return res.status(503).json({ error: 'Stripe non configuré' });
  const { amount, first_night_amount, payment_mode, metadata } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Montant invalide' });
  try {
    const onArrival   = payment_mode === 'on_arrival';
    const chargeAmt   = onArrival ? (first_night_amount || amount) : amount;
    const intent = await stripeClient.paymentIntents.create({
      amount:         Math.round(chargeAmt * 100),
      currency:       'eur',
      capture_method: onArrival ? 'manual' : 'automatic',
      metadata:       metadata || {},
      automatic_payment_methods: { enabled: true },
    });
    res.json({ clientSecret: intent.client_secret, id: intent.id });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUBLIC PAGES ──────────────────────────────────────────────────────────────

app.get('/chambre/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chambre.html'));
});

app.get('/checkout', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});

// ── PUBLIC API ────────────────────────────────────────────────────────────────

app.get('/api/rooms', (req, res) => {
  res.json(attachPhotos(db.prepare('SELECT * FROM rooms WHERE active = 1').all()));
});

app.get('/api/rooms/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id=? AND active=1').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Chambre introuvable' });
  const photos = db.prepare('SELECT * FROM room_photos WHERE room_id=? ORDER BY sort_order, id').all(req.params.id);
  const cat    = db.prepare('SELECT * FROM room_categories WHERE slug=?').get(room.type);
  res.json({ ...room, photos, roomCategory: cat || null });
});

app.get('/api/availability', (req, res) => {
  const { check_in, check_out, guests } = req.query;
  if (!check_in || !check_out) return res.status(400).json({ error: 'Dates requises' });
  const numGuests = parseInt(guests) || 1;
  const rooms = db.prepare(`
    SELECT r.* FROM rooms r
    WHERE r.active = 1 AND r.capacity >= ?
      AND r.id NOT IN (
        SELECT room_id FROM reservations
        WHERE status NOT IN ('cancelled') AND check_in < ? AND check_out > ?
      )
    ORDER BY r.price_per_night ASC
  `).all(numGuests, check_out, check_in);
  res.json(attachPhotos(rooms));
});

app.post('/api/bookings', (req, res) => {
  const { room_id, guest_name, guest_email, guest_phone, check_in, check_out, num_guests, notes } = req.body;
  if (!room_id || !guest_name || !guest_email || !check_in || !check_out)
    return res.status(400).json({ error: 'Champs obligatoires manquants' });

  const conflict = db.prepare(`
    SELECT id FROM reservations WHERE room_id=? AND status NOT IN ('cancelled') AND check_in<? AND check_out>?
  `).get(room_id, check_out, check_in);
  if (conflict) return res.status(409).json({ error: 'Chambre non disponible pour ces dates' });

  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(room_id);
  if (!room) return res.status(404).json({ error: 'Chambre introuvable' });

  const nights = Math.ceil((new Date(check_out) - new Date(check_in)) / 86400000);
  const total_price = nights * room.price_per_night;

  const r = db.prepare(`
    INSERT INTO reservations (room_id,guest_name,guest_email,guest_phone,check_in,check_out,num_guests,total_price,notes,source)
    VALUES (?,?,?,?,?,?,?,?,?,'website')
  `).run(room_id, guest_name, guest_email, guest_phone||null, check_in, check_out, num_guests||1, total_price, notes||null);

  res.json({ id: r.lastInsertRowid, total_price, nights });
});

app.post('/api/checkout/finalize', async (req, res) => {
  const { room_id, guest_name, guest_email, guest_phone, check_in, check_out, num_guests, notes, breakfast, arrival_time, payment_intent_id, payment_mode } = req.body;
  if (!room_id || !guest_name || !guest_email || !check_in || !check_out)
    return res.status(400).json({ error: 'Champs obligatoires manquants' });

  const pMode = payment_mode === 'on_arrival' ? 'on_arrival' : 'online';
  let stripeStatus = null;

  if (stripeClient) {
    if (!payment_intent_id) return res.status(402).json({ error: 'Paiement requis' });
    try {
      const intent = await stripeClient.paymentIntents.retrieve(payment_intent_id);
      const expectedStatus = pMode === 'on_arrival' ? 'requires_capture' : 'succeeded';
      if (intent.status !== expectedStatus) return res.status(402).json({ error: 'Paiement non confirmé' });
      stripeStatus = pMode === 'on_arrival' ? 'authorized' : 'captured';
    } catch(e) {
      return res.status(402).json({ error: 'Paiement invalide' });
    }
  }

  const conflict = db.prepare(`
    SELECT id FROM reservations WHERE room_id=? AND status NOT IN ('cancelled') AND check_in<? AND check_out>?
  `).get(room_id, check_out, check_in);
  if (conflict) return res.status(409).json({ error: 'Chambre non disponible pour ces dates' });

  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(room_id);
  if (!room) return res.status(404).json({ error: 'Chambre introuvable' });

  const nights = Math.ceil((new Date(check_out) - new Date(check_in)) / 86400000);
  const guests = parseInt(num_guests) || 1;
  const bkfFlag = breakfast ? 1 : 0;
  const bkfPrice = bkfFlag ? 20 * guests * nights : 0;
  const total_price = nights * room.price_per_night + bkfPrice;

  const r = db.prepare(`
    INSERT INTO reservations (room_id,guest_name,guest_email,guest_phone,check_in,check_out,num_guests,total_price,notes,source,breakfast,arrival_time,payment_mode,stripe_payment_intent_id,stripe_status)
    VALUES (?,?,?,?,?,?,?,?,?,'website',?,?,?,?,?)
  `).run(room_id, guest_name, guest_email, guest_phone||null, check_in, check_out, guests, total_price, notes||null, bkfFlag, arrival_time||null, pMode, payment_intent_id||null, stripeStatus);

  const cat = db.prepare('SELECT * FROM room_categories WHERE slug=?').get(room.type);
  let room_name = room.name || `Chambre ${room.room_number}`;
  if (cat) {
    try { const n = JSON.parse(cat.name); room_name = n.fr || room_name; } catch(e) {}
  }

  await sendConfirmationEmail({
    id: r.lastInsertRowid, room_name, guest_name, guest_email,
    check_in, check_out, nights, num_guests: guests,
    breakfast: bkfFlag, breakfast_price: bkfPrice,
    arrival_time: arrival_time || null, total_price,
    payment_mode: pMode,
  });

  res.json({ id: r.lastInsertRowid, total_price, nights, room_name, payment_mode: pMode });
});

app.get('/api/bookings/:id', (req, res) => {
  const b = db.prepare(`
    SELECT r.*, rm.name as room_name, rm.room_number, rm.type as room_type
    FROM reservations r JOIN rooms rm ON r.room_id = rm.id WHERE r.id=?
  `).get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Réservation introuvable' });
  res.json(b);
});

// ── STAFF AUTH ────────────────────────────────────────────────────────────────

app.post('/api/staff/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM staff WHERE username=?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Identifiants incorrects' });
  req.session.staffId = user.id;
  req.session.staffName = user.display_name;
  req.session.staffRole = user.role;
  res.json({ name: user.display_name, role: user.role });
});

app.post('/api/staff/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/staff/me', requireStaff, (req, res) => {
  res.json({ id: req.session.staffId, name: req.session.staffName, role: req.session.staffRole });
});

// ── STAFF API ─────────────────────────────────────────────────────────────────

app.get('/api/staff/stats', requireStaff, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    arrivals_today:   db.prepare(`SELECT COUNT(*) c FROM reservations WHERE check_in=? AND status='confirmed'`).get(today).c,
    departures_today: db.prepare(`SELECT COUNT(*) c FROM reservations WHERE check_out=? AND status='confirmed'`).get(today).c,
    occupied_tonight: db.prepare(`SELECT COUNT(*) c FROM reservations WHERE check_in<=? AND check_out>? AND status='confirmed'`).get(today, today).c,
    total_rooms:      db.prepare(`SELECT COUNT(*) c FROM rooms WHERE active=1`).get().c,
    pending:          db.prepare(`SELECT COUNT(*) c FROM reservations WHERE status='pending'`).get().c,
    revenue_month:    db.prepare(`SELECT COALESCE(SUM(total_price),0) s FROM reservations WHERE strftime('%Y-%m',check_in)=strftime('%Y-%m','now') AND status='confirmed'`).get().s,
  });
});

app.get('/api/staff/reservations', requireStaff, (req, res) => {
  const { status, from, to, search, room_id } = req.query;
  let sql = `SELECT r.*,rm.name room_name,rm.room_number,rm.type room_type FROM reservations r JOIN rooms rm ON r.room_id=rm.id WHERE 1=1`;
  const p = [];
  if (status)  { sql += ' AND r.status=?';                                    p.push(status); }
  if (from)    { sql += ' AND r.check_out>=?';                                p.push(from); }
  if (to)      { sql += ' AND r.check_in<=?';                                 p.push(to); }
  if (room_id) { sql += ' AND r.room_id=?';                                   p.push(room_id); }
  if (search)  { sql += ' AND (r.guest_name LIKE ? OR r.guest_email LIKE ?)'; p.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY r.check_in DESC';
  res.json(db.prepare(sql).all(...p));
});

app.get('/api/staff/reservations/:id', requireStaff, (req, res) => {
  const r = db.prepare(`SELECT r.*,rm.name room_name,rm.room_number,rm.price_per_night room_price FROM reservations r JOIN rooms rm ON r.room_id=rm.id WHERE r.id=?`).get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Introuvable' });
  res.json(r);
});

app.post('/api/staff/reservations/:id/cancel', requireStaff, async (req, res) => {
  const r = db.prepare(`
    SELECT rs.*,rm.price_per_night room_price
    FROM reservations rs JOIN rooms rm ON rs.room_id=rm.id WHERE rs.id=?
  `).get(req.params.id);
  if (!r)                    return res.status(404).json({ error: 'Introuvable' });
  if (r.status === 'cancelled') return res.status(400).json({ error: 'Déjà annulée' });

  // Deadline = check_in midnight - 48 h
  const deadline  = new Date(r.check_in + 'T00:00:00').getTime() - 48 * 3600 * 1000;
  const isInTime  = Date.now() < deadline;
  const firstNightCents = Math.round((r.room_price || 0) * 100);

  let stripeAction = null;

  if (stripeClient && r.stripe_payment_intent_id) {
    try {
      if (r.payment_mode === 'on_arrival') {
        if (isInTime) {
          await stripeClient.paymentIntents.cancel(r.stripe_payment_intent_id);
          stripeAction = 'released';
        } else {
          await stripeClient.paymentIntents.capture(r.stripe_payment_intent_id);
          stripeAction = 'captured_penalty';
        }
      } else {
        // online — full or partial refund
        const totalCents  = Math.round(r.total_price * 100);
        const refundCents = isInTime ? totalCents : Math.max(0, totalCents - firstNightCents);
        if (refundCents > 0) {
          await stripeClient.refunds.create({ payment_intent: r.stripe_payment_intent_id, amount: refundCents });
        }
        stripeAction = isInTime ? 'refunded' : (refundCents > 0 ? 'partially_refunded' : 'no_refund');
      }
    } catch(e) {
      return res.status(500).json({ error: `Erreur Stripe : ${e.message}` });
    }
  }

  const newStripeStatus = stripeAction || (r.stripe_status ? 'cancelled_manually' : null);
  db.prepare('UPDATE reservations SET status=?,stripe_status=? WHERE id=?')
    .run('cancelled', newStripeStatus, req.params.id);

  res.json({
    ok: true, isInTime,
    stripeAction,
    firstNight: r.room_price,
    paymentMode: r.payment_mode,
    totalPrice:  r.total_price,
  });
});

app.post('/api/staff/reservations', requireStaff, (req, res) => {
  const { room_id, guest_name, guest_email, guest_phone, check_in, check_out, num_guests, status, notes } = req.body;
  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(room_id);
  if (!room) return res.status(404).json({ error: 'Chambre introuvable' });
  const conflict = db.prepare(`SELECT id FROM reservations WHERE room_id=? AND status NOT IN ('cancelled') AND check_in<? AND check_out>?`).get(room_id, check_out, check_in);
  if (conflict) return res.status(409).json({ error: 'Chambre non disponible' });
  const nights = Math.ceil((new Date(check_out) - new Date(check_in)) / 86400000);
  const r = db.prepare(`INSERT INTO reservations (room_id,guest_name,guest_email,guest_phone,check_in,check_out,num_guests,status,total_price,notes,source) VALUES (?,?,?,?,?,?,?,?,?,?,'staff')`)
    .run(room_id, guest_name, guest_email, guest_phone||null, check_in, check_out, num_guests||1, status||'confirmed', nights*room.price_per_night, notes||null);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/staff/reservations/:id', requireStaff, (req, res) => {
  const { guest_name, guest_email, guest_phone, check_in, check_out, num_guests, status, notes, room_id } = req.body;
  const ex = db.prepare('SELECT * FROM reservations WHERE id=?').get(req.params.id);
  if (!ex) return res.status(404).json({ error: 'Introuvable' });
  const rId = room_id || ex.room_id;
  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(rId);
  if (!room) return res.status(404).json({ error: 'Chambre introuvable' });
  const ci = check_in || ex.check_in, co = check_out || ex.check_out;
  if ((status || ex.status) !== 'cancelled') {
    const conflict = db.prepare(`SELECT id FROM reservations WHERE room_id=? AND id!=? AND status NOT IN ('cancelled') AND check_in<? AND check_out>?`).get(rId, req.params.id, co, ci);
    if (conflict) return res.status(409).json({ error: 'Chambre non disponible' });
  }
  const nights = Math.ceil((new Date(co) - new Date(ci)) / 86400000);
  db.prepare(`UPDATE reservations SET room_id=?,guest_name=?,guest_email=?,guest_phone=?,check_in=?,check_out=?,num_guests=?,status=?,total_price=?,notes=? WHERE id=?`)
    .run(rId, guest_name||ex.guest_name, guest_email||ex.guest_email, guest_phone||ex.guest_phone, ci, co, num_guests||ex.num_guests, status||ex.status, nights*room.price_per_night, notes||ex.notes, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/staff/reservations/:id', requireStaff, (req, res) => {
  db.prepare('DELETE FROM reservations WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/staff/occupancy', requireStaff, (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Dates requises' });
  const rooms = db.prepare('SELECT * FROM rooms WHERE active=1').all();
  const reservations = db.prepare(`
    SELECT r.*,rm.name room_name,rm.room_number FROM reservations r JOIN rooms rm ON r.room_id=rm.id
    WHERE r.status NOT IN ('cancelled') AND r.check_in<=? AND r.check_out>=? ORDER BY r.check_in
  `).all(to, from);
  res.json({ rooms, reservations });
});

app.get('/api/staff/rooms', requireStaff, (req, res) => res.json(attachPhotos(db.prepare('SELECT * FROM rooms').all())));

app.post('/api/staff/rooms', requireStaff, (req, res) => {
  const { room_number, name, type, capacity, price_per_night, description, amenities } = req.body;
  if (!type || !capacity || !price_per_night)
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  const resolvedName = (name || '').trim() || (room_number || '').trim() || type;
  const r = db.prepare(
    'INSERT INTO rooms (room_number,name,type,capacity,price_per_night,description,amenities,active) VALUES (?,?,?,?,?,?,?,1)'
  ).run(room_number||null, resolvedName, type, parseInt(capacity), parseFloat(price_per_night), description||null, amenities||null);
  res.json({ id: r.lastInsertRowid, ok: true });
});

app.put('/api/staff/rooms/:id', requireStaff, (req, res) => {
  const { room_number, name, type, capacity, price_per_night, description, amenities, active } = req.body;
  db.prepare(`UPDATE rooms SET room_number=?,name=?,type=?,capacity=?,price_per_night=?,description=?,amenities=?,active=? WHERE id=?`)
    .run(room_number || null, name, type, capacity, price_per_night, description, amenities, active !== undefined ? active : 1, req.params.id);
  res.json({ ok: true });
});

app.post('/api/staff/rooms/:id/photos', requireStaff, uploadPhoto.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });
  const category = req.body.category || 'general';
  const r = db.prepare('INSERT INTO room_photos (room_id, filename, category) VALUES (?, ?, ?)').run(parseInt(req.params.id), req.file.filename, category);
  res.json({ id: r.lastInsertRowid, filename: req.file.filename, category });
});

app.delete('/api/staff/rooms/:id/photos/:photoId', requireStaff, (req, res) => {
  const photo = db.prepare('SELECT * FROM room_photos WHERE id=? AND room_id=?').get(req.params.photoId, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo introuvable' });
  try { fs.unlinkSync(path.join(__dirname, 'public', 'assets', 'images', 'rooms', String(req.params.id), photo.filename)); } catch(e) {}
  db.prepare('DELETE FROM room_photos WHERE id=?').run(req.params.photoId);
  res.json({ ok: true });
});

// ── CATEGORIES ────────────────────────────────────────────────────────────────

app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM room_categories ORDER BY sort_order, id').all());
});

app.get('/api/staff/categories', requireStaff, (req, res) => {
  res.json(db.prepare('SELECT * FROM room_categories ORDER BY sort_order, id').all());
});

app.post('/api/staff/categories', requireStaff, (req, res) => {
  const { slug, name, description, sort_order } = req.body;
  if (!slug) return res.status(400).json({ error: 'Slug requis' });
  try {
    const r = db.prepare('INSERT INTO room_categories (slug, name, description, sort_order) VALUES (?, ?, ?, ?)')
      .run(slug.trim(), JSON.stringify(name || {}), JSON.stringify(description || {}), sort_order || 0);
    res.json({ id: r.lastInsertRowid, ok: true });
  } catch(e) {
    res.status(409).json({ error: 'Ce slug existe déjà' });
  }
});

app.put('/api/staff/categories/:id', requireStaff, (req, res) => {
  const { slug, name, description, sort_order } = req.body;
  if (!slug) return res.status(400).json({ error: 'Slug requis' });
  try {
    db.prepare('UPDATE room_categories SET slug=?, name=?, description=?, sort_order=? WHERE id=?')
      .run(slug.trim(), JSON.stringify(name || {}), JSON.stringify(description || {}), sort_order || 0, req.params.id);
    res.json({ ok: true });
  } catch(e) {
    res.status(409).json({ error: 'Ce slug existe déjà' });
  }
});

app.delete('/api/staff/categories/:id', requireStaff, (req, res) => {
  db.prepare('DELETE FROM room_categories WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── EMPLOYEES ─────────────────────────────────────────────────────────────────

app.get('/api/staff/employees', requireStaff, (req, res) => {
  res.json(db.prepare('SELECT * FROM employees ORDER BY last_name, first_name').all());
});

app.post('/api/staff/employees', requireStaff, (req, res) => {
  const { first_name, last_name, role, phone, email, color, notes } = req.body;
  const r = db.prepare(`INSERT INTO employees (first_name,last_name,role,phone,email,color,notes) VALUES (?,?,?,?,?,?,?)`)
    .run(first_name, last_name, role||'femme_de_chambre', phone||null, email||null, color||'#2d6a4f', notes||null);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/staff/employees/:id', requireStaff, (req, res) => {
  const { first_name, last_name, role, phone, email, color, active, notes } = req.body;
  db.prepare(`UPDATE employees SET first_name=?,last_name=?,role=?,phone=?,email=?,color=?,active=?,notes=? WHERE id=?`)
    .run(first_name, last_name, role, phone||null, email||null, color||'#2d6a4f', active!==undefined?active:1, notes||null, req.params.id);
  res.json({ ok: true });
});

// ── SHIFTS ────────────────────────────────────────────────────────────────────

app.get('/api/staff/shifts', requireStaff, (req, res) => {
  const { from, to, employee_id } = req.query;
  let sql = `SELECT s.*,e.first_name,e.last_name,e.color FROM shifts s JOIN employees e ON s.employee_id=e.id WHERE 1=1`;
  const p = [];
  if (from)        { sql += ' AND s.date>=?'; p.push(from); }
  if (to)          { sql += ' AND s.date<=?'; p.push(to); }
  if (employee_id) { sql += ' AND s.employee_id=?'; p.push(employee_id); }
  sql += ' ORDER BY s.date,s.start_time';
  res.json(db.prepare(sql).all(...p));
});

app.post('/api/staff/shifts', requireStaff, (req, res) => {
  const { employee_id, date, start_time, end_time, type, notes } = req.body;
  const r = db.prepare(`INSERT INTO shifts (employee_id,date,start_time,end_time,type,notes) VALUES (?,?,?,?,?,?)`)
    .run(employee_id, date, start_time||null, end_time||null, type||'journee', notes||null);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/staff/shifts/:id', requireStaff, (req, res) => {
  const { employee_id, date, start_time, end_time, type, notes } = req.body;
  db.prepare(`UPDATE shifts SET employee_id=?,date=?,start_time=?,end_time=?,type=?,notes=? WHERE id=?`)
    .run(employee_id, date, start_time||null, end_time||null, type||'journee', notes||null, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/staff/shifts/:id', requireStaff, (req, res) => {
  db.prepare('DELETE FROM shifts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── HOUSEKEEPING ──────────────────────────────────────────────────────────────

app.get('/api/staff/housekeeping', requireStaff, (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Date requise' });
  res.json(db.prepare(`
    SELECT h.*, r.name room_name, r.room_number, r.type room_type,
           e.first_name emp_fname, e.last_name emp_lname
    FROM housekeeping h
    JOIN rooms r ON h.room_id=r.id
    LEFT JOIN employees e ON h.employee_id=e.id
    WHERE h.date=? ORDER BY h.type DESC, r.room_number, r.name
  `).all(date));
});

app.post('/api/staff/housekeeping/generate', requireStaff, (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'Date requise' });
  const departures = db.prepare(`SELECT DISTINCT room_id FROM reservations WHERE check_out=? AND status='confirmed'`).all(date);
  const ongoing    = db.prepare(`SELECT DISTINCT room_id FROM reservations WHERE check_in<?  AND check_out>? AND status='confirmed'`).all(date, date);
  const deptIds    = new Set(departures.map(r => r.room_id));
  const exists     = db.prepare(`SELECT id FROM housekeeping WHERE room_id=? AND date=?`);
  const ins        = db.prepare(`INSERT INTO housekeeping (room_id,date,type,status) VALUES (?,?,'__','pending')`);
  let created = 0;
  for (const r of departures) {
    if (!exists.get(r.room_id, date)) { db.prepare(`INSERT INTO housekeeping (room_id,date,type,status) VALUES (?,'${date}','mise_a_blanc','pending')`).run(r.room_id); created++; }
  }
  for (const r of ongoing) {
    if (!deptIds.has(r.room_id) && !exists.get(r.room_id, date)) {
      db.prepare(`INSERT INTO housekeeping (room_id,date,type,status) VALUES (?,'${date}','recouche','pending')`).run(r.room_id); created++;
    }
  }
  res.json({ created });
});

app.put('/api/staff/housekeeping/:id', requireStaff, (req, res) => {
  const { status, employee_id, notes } = req.body;
  const completed_at = status === 'done' ? new Date().toISOString() : null;
  db.prepare(`UPDATE housekeeping SET status=?,employee_id=?,notes=?,completed_at=? WHERE id=?`)
    .run(status, employee_id||null, notes||null, completed_at, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/staff/housekeeping/:id', requireStaff, (req, res) => {
  db.prepare('DELETE FROM housekeeping WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── REVIEWS (LIVRE D'OR) ──────────────────────────────────────────────────────

app.post('/api/reviews', (req, res) => {
  const { name, rating, comment, consent, source } = req.body;
  if (!name || !rating || !comment) return res.status(400).json({ error: 'Champs obligatoires manquants' });
  const r = db.prepare(`INSERT INTO reviews (name,rating,comment,consent,source) VALUES (?,?,?,?,?)`)
    .run(name.trim(), parseInt(rating), comment.trim(), consent ? 1 : 0, source === 'kiosk' ? 'kiosk' : 'qr');
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/reviews/approved', (req, res) => {
  res.json(db.prepare(`SELECT id,name,rating,comment,created_at FROM reviews WHERE approved=1 AND consent=1 ORDER BY created_at DESC`).all());
});

app.get('/api/staff/reviews', requireStaff, (req, res) => {
  const { status } = req.query;
  let sql = `SELECT * FROM reviews WHERE 1=1`;
  const p = [];
  if (status === 'pending')  { sql += ` AND approved=0`; }
  if (status === 'approved') { sql += ` AND approved=1`; }
  sql += ` ORDER BY created_at DESC`;
  res.json(db.prepare(sql).all(...p));
});

app.patch('/api/staff/reviews/:id', requireStaff, (req, res) => {
  const { approved } = req.body;
  db.prepare(`UPDATE reviews SET approved=? WHERE id=?`).run(approved ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/staff/reviews/:id', requireStaff, (req, res) => {
  db.prepare(`DELETE FROM reviews WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// ── KIOSK / REVIEW ROUTES ─────────────────────────────────────────────────────

app.get('/api/qr', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}/review`;
  try {
    const MARGIN = 2;
    const DARK   = '#1b4332';
    const LIGHT  = '#ffffff';
    const S      = 0.82;  // taille du module (< 1 = léger espacement entre carrés)
    const OFF    = (1 - S) / 2;
    const RX     = 0.22;  // arrondi des modules individuels
    const RXF    = 0.9;   // arrondi des carrés de positionnement

    // Matrice brute — 1 = sombre, 0 = clair
    const qr             = QRCode.create(url, { errorCorrectionLevel: 'H' });
    const { size, data } = qr.modules;
    const N              = size + MARGIN * 2;

    // Les 3 zones de positionnement (7×7) — traitées séparément
    const isFinderZone = (r, c) =>
      (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);

    // Modules individuels arrondis (hors zones de positionnement)
    let modules = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (data[r * size + c] && !isFinderZone(r, c)) {
          modules += `<rect x="${c + MARGIN + OFF}" y="${r + MARGIN + OFF}" width="${S}" height="${S}" rx="${RX}" fill="${DARK}"/>`;
        }
      }
    }

    // Carrés de positionnement avec style bordé arrondi
    const finders = [
      { x: MARGIN,         y: MARGIN },
      { x: N - MARGIN - 7, y: MARGIN },
      { x: MARGIN,         y: N - MARGIN - 7 },
    ];
    const findersSvg = finders.map(({ x, y }) =>
      `<rect x="${x}"     y="${y}"     width="7" height="7" fill="${DARK}"  rx="${RXF}"/>` +
      `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="${LIGHT}" rx="${RXF * 0.5}"/>` +
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="${DARK}"  rx="${RXF * 0.35}"/>`
    ).join('');

    const svg     = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}"><rect width="${N}" height="${N}" fill="${LIGHT}"/>${modules}${findersSvg}</svg>`;
    const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

    res.json({ dataUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/kiosk',  (_, res) => res.sendFile(path.join(__dirname, 'kiosk', 'index.html')));
app.use('/kiosk',  express.static(path.join(__dirname, 'kiosk')));
app.get('/review', (_, res) => res.sendFile(path.join(__dirname, 'public', 'review.html')));

app.listen(PORT, () => {
  console.log(`\n  Hotel Ginkgo  →  http://localhost:${PORT}`);
  console.log(`  Staff panel   →  http://localhost:${PORT}/staff/\n`);
  console.log(`  Kiosk         →  http://localhost:${PORT}/kiosk\n`);
  console.log(`  Logins: admin / admin123   |   reception / reception\n`);
});
