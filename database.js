const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'hotel.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name  TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'femme_de_chambre',
    phone      TEXT,
    email      TEXT,
    color      TEXT DEFAULT '#2d6a4f',
    active     INTEGER DEFAULT 1,
    notes      TEXT
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    date        TEXT NOT NULL,
    start_time  TEXT,
    end_time    TEXT,
    type        TEXT DEFAULT 'journee',
    notes       TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS housekeeping (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id     INTEGER NOT NULL,
    date        TEXT NOT NULL,
    type        TEXT NOT NULL,
    status      TEXT DEFAULT 'pending',
    employee_id INTEGER,
    notes       TEXT,
    completed_at TEXT,
    FOREIGN KEY (room_id)     REFERENCES rooms(id),
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_number TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    capacity INTEGER NOT NULL,
    price_per_night REAL NOT NULL,
    description TEXT,
    amenities TEXT,
    image TEXT,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    guest_phone TEXT,
    check_in TEXT NOT NULL,
    check_out TEXT NOT NULL,
    num_guests INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'confirmed',
    total_price REAL NOT NULL,
    notes TEXT,
    source TEXT DEFAULT 'website',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT DEFAULT 'receptionist'
  );
`);

// Migration: add room_number column if missing (safe on existing DB)
try { db.exec('ALTER TABLE rooms ADD COLUMN room_number TEXT'); } catch(e) {}

// Seed rooms if empty
const roomCount = db.prepare('SELECT COUNT(*) as c FROM rooms').get().c;
if (roomCount === 0) {
  const insert = db.prepare(`
    INSERT INTO rooms (room_number, name, type, capacity, price_per_night, description, amenities, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const DESC = {
    duplex:       'Chambre de 27 m² en duplex avec entrée indépendante et accès direct au jardin. La chambre, avec son lit 160×200 cm, se trouve à l\'étage accessible par un escalier. Au rez-de-chaussée : espace bureau, dressing avec porte-bagages et coffre-fort, salle de bain avec douche effet pluie. Linge de lit en percale coton-soie, oreillers et couettes hypoallergéniques.',
    superieure:   'Chambre de 27 à 30 m² au rez-de-chaussée, au design minimaliste avec éclairage intégré dans la tête de lit. Lit 180×200 cm, climatisation, une chambre adaptée aux personnes à mobilité réduite. Douche à l\'italienne effet pluie avec douchette, robinetterie haut de gamme Rituals. Bouilloire, thé & café bio, crêpes et galettes bretonnes offerts.',
    prestige:     'Chambre de 30 m² au premier étage avec vue sur le jardin classé remarquable et le fleuve Odet. Mobilier design et minimaliste, tête de lit en velours capitonné, ambiance lumineuse soignée. Lit 180×200 cm, climatisation. Douche à l\'italienne effet pluie, machine à expresso, carafe d\'eau filtrée, galettes et dentelles bretonnes.',
    junior_suite: 'Suite de 35 m² avec espace salon séparé doté d\'un canapé, fauteuils et bureau. Mobilier design contemporain en bois noble et métal. Lit 180 ou 200 cm, possible en configuration twin (2×100 cm). Climatisation, douche à l\'italienne ou baignoire, WC séparé. Possibilité d\'accueillir 1 à 2 enfants sur lit pliant (32 €/nuit). Deux suites configurées en chambres familiales.',
    suite:        'Suite de 50 m² offrant un confort unique et exclusif. Grand salon avec canapé, fauteuil et table basse, table à manger 4 couverts. Terrasse privée avec transats et mobilier de jardin face au jardin classé remarquable. Mobilier sur mesure par des artisans. Lit 180 cm, climatisation, deux TV (salon + chambre), douche à l\'italienne, WC séparé, machine à expresso, carafe filtrée.',
  };
  const AMENITIES = {
    duplex:       'Wi-Fi haut débit,TV écran plat,Téléphone numérique,Coffre-fort,Douche effet pluie,Peignoir & chaussons,Rituals,Bouilloire bio,Crêpes bretonnes',
    superieure:   'Wi-Fi haut débit,TV écran plat,Climatisation,Coffre-fort,Douche effet pluie,PMR disponible,Rituals,Bouilloire bio,Crêpes bretonnes',
    prestige:     'Wi-Fi haut débit,TV écran plat,Climatisation,Coffre-fort,Vue jardin & Odet,Machine expresso,Douche effet pluie,Rituals,Crêpes bretonnes',
    junior_suite: 'Wi-Fi haut débit,TV écran plat,Climatisation,Salon séparé,Douche ou baignoire,WC séparé,Machine expresso,Coffre-fort,Crêpes bretonnes',
    suite:        'Wi-Fi haut débit,2 TV écran plat,Climatisation,Terrasse privée,Salon & salle à manger,Vue jardin remarquable,Machine expresso,WC séparé,Rituals',
  };

  // 20 rooms — plan réel de l'hôtel (pas de chambre 13)
  // RDC bâtiment principal : 1–6 (Supérieure)
  // Duplex bâtiment annexe, plein pied, entrée extérieure : 7–12
  // 1er étage : Suite 1, Suite 2, 14, 15
  // 2ème étage : Suite 3, Suite 4, 16, 17
  const rooms = [
    // ── RDC — Bâtiment principal ─────────────────────────────────────────────
    ['1',       'Chambre Supérieure', 'superieure',   2, 129, DESC.superieure,   AMENITIES.superieure,   'room-superieure.jpg'],
    ['2',       'Chambre Supérieure', 'superieure',   2, 129, DESC.superieure,   AMENITIES.superieure,   'room-superieure.jpg'],
    ['3',       'Chambre Supérieure', 'superieure',   2, 129, DESC.superieure,   AMENITIES.superieure,   'room-superieure.jpg'],
    ['4',       'Chambre Supérieure', 'superieure',   2, 129, DESC.superieure,   AMENITIES.superieure,   'room-superieure.jpg'],
    ['5',       'Chambre Supérieure', 'superieure',   2, 129, DESC.superieure,   AMENITIES.superieure,   'room-superieure.jpg'],
    ['6',       'Chambre Supérieure', 'superieure',   2, 129, DESC.superieure,   AMENITIES.superieure,   'room-superieure.jpg'],
    // ── Duplex — Bâtiment annexe, accès extérieur, plain-pied ────────────────
    ['7',       'Confort en Duplex',  'duplex',       2, 109, DESC.duplex,       AMENITIES.duplex,       'room-duplex.jpg'],
    ['8',       'Confort en Duplex',  'duplex',       2, 109, DESC.duplex,       AMENITIES.duplex,       'room-duplex.jpg'],
    ['9',       'Confort en Duplex',  'duplex',       2, 109, DESC.duplex,       AMENITIES.duplex,       'room-duplex.jpg'],
    ['10',      'Confort en Duplex',  'duplex',       2, 109, DESC.duplex,       AMENITIES.duplex,       'room-duplex.jpg'],
    ['11',      'Confort en Duplex',  'duplex',       2, 109, DESC.duplex,       AMENITIES.duplex,       'room-duplex.jpg'],
    ['12',      'Confort en Duplex',  'duplex',       2, 109, DESC.duplex,       AMENITIES.duplex,       'room-duplex.jpg'],
    // ── 1er étage ────────────────────────────────────────────────────────────
    ['Suite 1', 'Suite Junior',       'junior_suite', 3, 179, DESC.junior_suite, AMENITIES.junior_suite, 'room-junior-suite.jpg'],
    ['Suite 2', 'Suite Junior',       'junior_suite', 3, 179, DESC.junior_suite, AMENITIES.junior_suite, 'room-junior-suite.jpg'],
    ['14',      'Chambre Prestige',   'prestige',     2, 149, DESC.prestige,     AMENITIES.prestige,     'room-prestige.jpg'],
    ['15',      'Chambre Prestige',   'prestige',     2, 149, DESC.prestige,     AMENITIES.prestige,     'room-prestige.jpg'],
    // ── 2ème étage ───────────────────────────────────────────────────────────
    ['Suite 3', 'Suite Prestige',     'suite',        2, 249, DESC.suite,        AMENITIES.suite,        'room-suite.jpg'],
    ['Suite 4', 'Suite Prestige',     'suite',        2, 249, DESC.suite,        AMENITIES.suite,        'room-suite.jpg'],
    ['16',      'Chambre Prestige',   'prestige',     2, 149, DESC.prestige,     AMENITIES.prestige,     'room-prestige.jpg'],
    ['17',      'Chambre Prestige',   'prestige',     2, 149, DESC.prestige,     AMENITIES.prestige,     'room-prestige.jpg'],
  ];
  rooms.forEach(r => insert.run(...r));
}

// Seed employees if empty
const empCount = db.prepare('SELECT COUNT(*) c FROM employees').get().c;
if (empCount === 0) {
  const ei = db.prepare(`INSERT INTO employees (first_name,last_name,role,phone,color) VALUES (?,?,?,?,?)`);
  ei.run('Sophie',  'Martin',   'femme_de_chambre', '06 12 34 56 78', '#7c3aed');
  ei.run('Lucie',   'Bernard',  'femme_de_chambre', '06 23 45 67 89', '#0e7490');
  ei.run('Jean',    'Dupont',   'receptionniste',   '06 34 56 78 90', '#b45309');
  ei.run('Marie',   'Lefebvre', 'responsable',      '06 45 67 89 01', '#be185d');
}

// Seed admin if empty
const staffCount = db.prepare('SELECT COUNT(*) as c FROM staff').get().c;
if (staffCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO staff (username, password_hash, display_name, role) VALUES (?,?,?,?)').run('admin', hash, 'Administrateur', 'admin');
  const hash2 = bcrypt.hashSync('reception', 10);
  db.prepare('INSERT INTO staff (username, password_hash, display_name, role) VALUES (?,?,?,?)').run('reception', hash2, 'Réception', 'receptionist');
}

module.exports = db;
