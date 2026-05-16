/**
 * Génère de fausses réservations réalistes sur les 6 derniers mois
 * et les 2 prochains mois. Ne touche pas aux chambres, catégories,
 * photos ni aux employés.
 *
 * Usage : node seed-reservations.js [--clear]
 *   --clear  supprime toutes les réservations existantes avant d'insérer
 */

const db = require('./database');

const CLEAR = process.argv.includes('--clear');

// ── Données fictives ──────────────────────────────────────────────────────────

const GUESTS = [
  ['Marie Lefebvre',    'marie.lefebvre@gmail.com',    '06 12 34 56 78'],
  ['Thomas Bernard',   'thomas.bernard@outlook.fr',   '06 23 45 67 89'],
  ['Sophie Martin',    'sophie.martin@yahoo.fr',      null],
  ['Julien Moreau',    'julien.moreau@free.fr',       '07 34 56 78 90'],
  ['Camille Dupont',   'camille.dupont@gmail.com',    '06 45 67 89 01'],
  ['Alexandre Petit',  'a.petit@entreprise.com',      '06 56 78 90 12'],
  ['Isabelle Roux',    'isabelle.roux@sfr.fr',        null],
  ['Nicolas Girard',   'n.girard@hotmail.fr',         '07 67 89 01 23'],
  ['Émilie Lambert',   'emilie.lambert@gmail.com',    '06 78 90 12 34'],
  ['Pierre Leroy',     'pierre.leroy@laposte.net',    '06 89 01 23 45'],
  ['Claire Simon',     'claire.simon@gmail.com',      null],
  ['Antoine Mercier',  'a.mercier@wanadoo.fr',        '07 90 12 34 56'],
  ['Lucie Fontaine',   'lucie.fontaine@gmail.com',    '06 01 23 45 67'],
  ['François Bonnet',  'f.bonnet@outlook.com',        '06 11 22 33 44'],
  ['Sarah Garnier',    'sarah.garnier@gmail.com',     null],
  ['Marc Rousseau',    'm.rousseau@live.fr',          '07 22 33 44 55'],
  ['Nathalie Vincent', 'n.vincent@gmail.com',         '06 33 44 55 66'],
  ['Laurent Morel',    'l.morel@free.fr',             null],
  ['Aurélie Dupuis',   'aurelie.dupuis@gmail.com',    '06 44 55 66 77'],
  ['Benoît Chevalier', 'b.chevalier@sfr.fr',          '07 55 66 77 88'],
  ['Hanna Müller',     'hanna.mueller@gmail.de',      null],
  ['James Wilson',     'james.wilson@gmail.com',      '+44 7700 900123'],
  ['Elena Rossi',      'elena.rossi@libero.it',       null],
  ['Carlos García',    'carlos.garcia@gmail.es',      '+34 612 345 678'],
  ['Yuki Tanaka',      'yuki.tanaka@gmail.com',       null],
  ['Amelia Thompson',  'amelia.t@yahoo.co.uk',        '+44 7911 123456'],
  ['Lucas Hoffmann',   'l.hoffmann@web.de',           null],
  ['Chloé Dubois',     'chloe.dubois@gmail.com',      '06 66 77 88 99'],
  ['Romain Blanc',     'r.blanc@gmail.com',           '07 77 88 99 00'],
  ['Vanessa Lemaire',  'v.lemaire@orange.fr',         '06 88 99 00 11'],
];

const NOTES = [
  null,
  null,
  null,
  'Arrivée tardive prévue vers 22h.',
  'Demande d\'oreiller supplémentaire.',
  'Anniversaire de mariage — surprise possible.',
  'Allergie aux fruits à coque.',
  'Voyage d\'affaires — besoin d\'une facture.',
  'Lit bébé requis.',
  'Végétarien — merci de le noter pour le petit-déjeuner.',
  'Chambre calme de préférence.',
  'Départ très tôt le matin (5h30).',
];

const SOURCES = ['website', 'website', 'website', 'staff'];
const STATUSES_PAST   = ['confirmed', 'confirmed', 'confirmed', 'cancelled'];
const STATUSES_FUTURE = ['confirmed', 'confirmed', 'pending', 'cancelled'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isoToday() { return new Date().toISOString().slice(0, 10); }

function randomDateInRange(startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00Z').getTime();
  const end   = new Date(endStr   + 'T00:00:00Z').getTime();
  const ts    = start + Math.random() * (end - start);
  return new Date(ts).toISOString().slice(0, 10);
}

function hasConflict(roomId, checkIn, checkOut, excludeId = null) {
  let sql = `SELECT id FROM reservations
    WHERE room_id=? AND status NOT IN ('cancelled')
    AND check_in < ? AND check_out > ?`;
  const params = [roomId, checkOut, checkIn];
  if (excludeId) { sql += ' AND id != ?'; params.push(excludeId); }
  return !!db.prepare(sql).get(...params);
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (CLEAR) {
  db.prepare('DELETE FROM reservations').run();
  console.log('Réservations existantes supprimées.');
}

const rooms = db.prepare('SELECT * FROM rooms WHERE active = 1').all();
if (!rooms.length) { console.error('Aucune chambre trouvée.'); process.exit(1); }

const today    = isoToday();
const pastFrom = addDays(today, -180);
const futureTO = addDays(today,   60);

let inserted = 0, skipped = 0;

const insert = db.prepare(`
  INSERT INTO reservations
    (room_id, guest_name, guest_email, guest_phone,
     check_in, check_out, num_guests, status, total_price, notes, source)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)
`);

// Durées de séjour pondérées (nuits)
const STAY_WEIGHTS = [1,1,2,2,2,3,3,3,4,5,6,7];

function generateReservations(count, fromDate, toDate, statusPool) {
  for (let attempt = 0; attempt < count * 3 && inserted < count + (CLEAR ? 0 : inserted); attempt++) {
    const room     = pick(rooms);
    const nights   = pick(STAY_WEIGHTS);
    const checkIn  = randomDateInRange(fromDate, addDays(toDate, -nights));
    const checkOut = addDays(checkIn, nights);

    if (hasConflict(room.id, checkIn, checkOut)) { skipped++; continue; }

    const [name, email, phone] = pick(GUESTS);
    const numGuests = Math.min(room.capacity, 1 + Math.floor(Math.random() * room.capacity));
    const status    = pick(statusPool);
    const total     = parseFloat((nights * room.price_per_night).toFixed(2));

    insert.run(
      room.id, name, email, phone,
      checkIn, checkOut, numGuests,
      status, total,
      pick(NOTES), pick(SOURCES)
    );
    inserted++;
  }
}

// Réservations passées (6 mois) — mix confirmé / annulé
const TARGET_PAST   = 120;
const TARGET_FUTURE =  40;

generateReservations(TARGET_PAST,   pastFrom, today,    STATUSES_PAST);
generateReservations(TARGET_FUTURE, today,    futureTO, STATUSES_FUTURE);

const total = db.prepare('SELECT COUNT(*) c FROM reservations').get().c;
console.log(`✔  ${inserted} réservations insérées (${skipped} conflits ignorés)`);
console.log(`   Total en base : ${total} réservations`);
