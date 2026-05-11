const express = require('express');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = 3000;

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

// ── PUBLIC API ────────────────────────────────────────────────────────────────

app.get('/api/rooms', (req, res) => {
  res.json(db.prepare('SELECT * FROM rooms WHERE active = 1').all());
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
  res.json(rooms);
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
  const r = db.prepare(`SELECT r.*,rm.name room_name,rm.room_number FROM reservations r JOIN rooms rm ON r.room_id=rm.id WHERE r.id=?`).get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Introuvable' });
  res.json(r);
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
    WHERE r.status NOT IN ('cancelled') AND r.check_in<? AND r.check_out>? ORDER BY r.check_in
  `).all(to, from);
  res.json({ rooms, reservations });
});

app.get('/api/staff/rooms', requireStaff, (req, res) => res.json(db.prepare('SELECT * FROM rooms').all()));

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

app.listen(PORT, () => {
  console.log(`\n  Hotel Ginkgo  →  http://localhost:${PORT}`);
  console.log(`  Staff panel   →  http://localhost:${PORT}/staff/\n`);
  console.log(`  Logins: admin / admin123   |   reception / reception\n`);
});
