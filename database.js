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

// Migration: room categories table
try {
  db.exec(`CREATE TABLE IF NOT EXISTS room_categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL DEFAULT '{}',
    description TEXT DEFAULT '{}',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
} catch(e) {}

// Seed categories from existing room types if table is empty
{
  const catCount = db.prepare('SELECT COUNT(*) c FROM room_categories').get().c;
  if (catCount === 0) {
    const types = db.prepare('SELECT DISTINCT type FROM rooms WHERE type IS NOT NULL').all().map(r => r.type);
    const ins = db.prepare('INSERT OR IGNORE INTO room_categories (slug, name, sort_order) VALUES (?, ?, ?)');
    types.forEach((t, i) => ins.run(t, JSON.stringify({ fr: t, en: '', de: '', es: '', it: '' }), i));
  }
}

// Migration: populate multilingual names + descriptions for the 5 seeded categories
{
  const existingCat = db.prepare("SELECT description FROM room_categories WHERE description IS NULL OR description='{}' LIMIT 1").get();
  if (existingCat) {
    const CAT_DATA = {
      'Chambre Supérieure': {
        name: { fr: 'Chambre Supérieure', en: 'Superior Room', de: 'Superior-Zimmer', es: 'Habitación Superior', it: 'Camera Superiore' },
        description: {
          fr: `Chambre de 27 à 30 m² au rez-de-chaussée, au design minimaliste avec éclairage intégré dans la tête de lit. Lit 180×200 cm, climatisation, une chambre adaptée aux personnes à mobilité réduite. Douche à l'italienne effet pluie avec douchette, robinetterie haut de gamme Rituals. Bouilloire, thé & café bio, crêpes et galettes bretonnes offerts.`,
          en: `27 to 30 m² ground-floor room with minimalist design and built-in headboard lighting. 180×200 cm bed, air conditioning, one room adapted for reduced-mobility guests. Italian-style rain shower with handheld showerhead, premium Rituals fittings. Kettle, organic tea & coffee, complimentary Breton crêpes and galettes.`,
          de: `27 bis 30 m² großes Erdgeschosszimmer mit minimalistischem Design und integrierter Beleuchtung im Kopfteil. Bett 180×200 cm, Klimaanlage, ein Zimmer für Gäste mit eingeschränkter Mobilität. Regendusche im italienischen Stil mit Handbrause, hochwertige Rituals-Armaturen. Wasserkocher, Bio-Tee & Kaffee, bretonische Crêpes und Galettes inklusive.`,
          es: `Habitación de 27 a 30 m² en planta baja, diseño minimalista con iluminación integrada en el cabecero. Cama de 180×200 cm, aire acondicionado, una habitación adaptada para personas con movilidad reducida. Ducha italiana efecto lluvia con ducha de mano, grifería premium Rituals. Hervidor, té y café ecológicos, crêpes y galettes bretonas cortesía del hotel.`,
          it: `Camera da 27 a 30 m² al piano terra, design minimalista con illuminazione integrata nella testiera. Letto 180×200 cm, aria condizionata, una camera adattata per ospiti a mobilità ridotta. Doccia italiana effetto pioggia con doccetta, rubinetteria premium Rituals. Bollitore, tè e caffè biologici, crêpes e galettes bretoni in omaggio.`,
        },
      },
      'Confort Duplex': {
        name: { fr: 'Confort en Duplex', en: 'Duplex Room', de: 'Duplex-Zimmer', es: 'Habitación Dúplex', it: 'Camera Duplex' },
        description: {
          fr: `Chambre de 27 m² en duplex avec entrée indépendante et accès direct au jardin. La chambre, avec son lit 160×200 cm, se trouve à l'étage accessible par un escalier. Au rez-de-chaussée : espace bureau, dressing avec porte-bagages et coffre-fort, salle de bain avec douche effet pluie. Linge de lit en percale coton-soie, oreillers et couettes hypoallergéniques.`,
          en: `27 m² duplex room with independent entrance and direct garden access. The bedroom with its 160×200 cm bed is on the upper level, reached by stairs. Ground floor: desk area, dressing room with luggage rack and safe, bathroom with rain shower. Cotton-silk percale bed linen, hypoallergenic pillows and duvets.`,
          de: `27 m² großes Duplexzimmer mit eigenem Eingang und direktem Gartenzugang. Das Schlafzimmer mit Bett 160×200 cm befindet sich im Obergeschoss, erreichbar über eine Treppe. Erdgeschoss: Schreibtischbereich, Ankleidezimmer mit Kofferablage und Safe, Badezimmer mit Regendusche. Bettwäsche aus Baumwoll-Seide-Perkal, hypoallergene Kissen und Bettdecken.`,
          es: `Habitación dúplex de 27 m² con entrada independiente y acceso directo al jardín. El dormitorio con cama de 160×200 cm se encuentra en la planta superior, accesible por escaleras. Planta baja: zona de escritorio, vestidor con portamaletas y caja fuerte, baño con ducha efecto lluvia. Ropa de cama de percal algodón-seda, almohadas y edredones hipoalergénicos.`,
          it: `Camera duplex di 27 m² con ingresso indipendente e accesso diretto al giardino. La camera da letto con letto 160×200 cm si trova al piano superiore, raggiungibile tramite scala. Piano terra: zona scrivania, cabina armadio con portabagagli e cassaforte, bagno con doccia effetto pioggia. Biancheria da letto in percalle cotone-seta, cuscini e piumini anallergici.`,
        },
      },
      'Chambre Prestige': {
        name: { fr: 'Chambre Prestige', en: 'Prestige Room', de: 'Prestige-Zimmer', es: 'Habitación Prestige', it: 'Camera Prestige' },
        description: {
          fr: `Chambre de 30 m² au premier étage avec vue sur le jardin classé remarquable et le fleuve Odet. Mobilier design et minimaliste, tête de lit en velours capitonné, ambiance lumineuse soignée. Lit 180×200 cm, climatisation. Douche à l'italienne effet pluie, machine à expresso, carafe d'eau filtrée, galettes et dentelles bretonnes.`,
          en: `30 m² first-floor room with views over the listed remarkable garden and the Odet river. Contemporary minimalist furniture, tufted velvet headboard, carefully considered lighting. 180×200 cm bed, air conditioning. Italian-style rain shower, espresso machine, filtered water carafe, Breton galettes and lace biscuits.`,
          de: `30 m² großes Zimmer im ersten Stock mit Blick auf den denkmalgeschützten Garten und den Fluss Odet. Zeitgenössisches minimalistisches Mobiliar, gepolstertes Samtkopfteil, sorgfältig gestaltete Lichtatmosphäre. Bett 180×200 cm, Klimaanlage. Regendusche im italienischen Stil, Espressomaschine, Karaffe mit gefiltertem Wasser, bretonische Galettes und Dentelles.`,
          es: `Habitación de 30 m² en primera planta con vistas al jardín notable catalogado y el río Odet. Mobiliario contemporáneo minimalista, cabecero capitoné de terciopelo, ambiente luminoso cuidado. Cama de 180×200 cm, aire acondicionado. Ducha italiana efecto lluvia, cafetera espresso, jarra de agua filtrada, galettes y dentelles bretonas.`,
          it: `Camera di 30 m² al primo piano con vista sul giardino classificato notevole e il fiume Odet. Arredamento contemporaneo minimalista, testiera imbottita in velluto, atmosfera luminosa curata. Letto 180×200 cm, aria condizionata. Doccia italiana effetto pioggia, macchina per espresso, caraffa d'acqua filtrata, galettes e dentelles bretoni.`,
        },
      },
      'Suite Junior': {
        name: { fr: 'Suite Junior', en: 'Junior Suite', de: 'Junior-Suite', es: 'Suite Junior', it: 'Suite Junior' },
        description: {
          fr: `Suite de 35 m² avec espace salon séparé doté d'un canapé, fauteuils et bureau. Mobilier design contemporain en bois noble et métal. Lit 180 ou 200 cm, possible en configuration twin (2×100 cm). Climatisation, douche à l'italienne ou baignoire, WC séparé. Possibilité d'accueillir 1 à 2 enfants sur lit pliant (32 €/nuit). Deux suites configurées en chambres familiales.`,
          en: `35 m² suite with a separate lounge area featuring a sofa, armchairs and desk. Contemporary design furniture in noble wood and metal. 180 or 200 cm bed, available in twin configuration (2×100 cm). Air conditioning, Italian-style shower or bathtub, separate WC. Option to accommodate 1–2 children on a fold-out bed (€32/night). Two suites configured as family rooms.`,
          de: `35 m² große Suite mit separatem Wohnbereich mit Sofa, Sesseln und Schreibtisch. Zeitgenössisches Designmöbel aus Edelholz und Metall. Bett 180 oder 200 cm, möglich als Twin-Konfiguration (2×100 cm). Klimaanlage, Regendusche oder Badewanne, separates WC. Möglichkeit für 1–2 Kinder auf einem Klappbett (32 €/Nacht). Zwei Suiten als Familienzimmer konfiguriert.`,
          es: `Suite de 35 m² con zona salón separada con sofá, sillones y escritorio. Mobiliario de diseño contemporáneo en madera noble y metal. Cama de 180 o 200 cm, posible en configuración twin (2×100 cm). Aire acondicionado, ducha italiana o bañera, WC separado. Posibilidad de alojar 1–2 niños en cama plegable (32 €/noche). Dos suites configuradas como habitaciones familiares.`,
          it: `Suite di 35 m² con zona soggiorno separata con divano, poltrone e scrivania. Arredamento di design contemporaneo in legno nobile e metallo. Letto 180 o 200 cm, disponibile in configurazione twin (2×100 cm). Aria condizionata, doccia italiana o vasca da bagno, WC separato. Possibilità di ospitare 1–2 bambini su letto pieghevole (32 €/notte). Due suite configurate come camere familiari.`,
        },
      },
      'Suite Prestige': {
        name: { fr: 'Suite Prestige', en: 'Prestige Suite', de: 'Prestige-Suite', es: 'Suite Prestige', it: 'Suite Prestige' },
        description: {
          fr: `Suite de 50 m² offrant un confort unique et exclusif. Grand salon avec canapé, fauteuil et table basse, table à manger 4 couverts. Terrasse privée avec transats et mobilier de jardin face au jardin classé remarquable. Mobilier sur mesure par des artisans. Lit 180 cm, climatisation, deux TV (salon + chambre), douche à l'italienne, WC séparé, machine à expresso, carafe filtrée.`,
          en: `50 m² suite offering unique and exclusive comfort. Large lounge with sofa, armchair and coffee table, dining table for 4. Private terrace with sun loungers and garden furniture facing the remarkable listed garden. Custom-made furniture by local craftsmen. 180 cm bed, air conditioning, two TVs (lounge + bedroom), Italian-style shower, separate WC, espresso machine, filtered carafe.`,
          de: `50 m² große Suite mit einzigartigem und exklusivem Komfort. Großer Salon mit Sofa, Sessel und Couchtisch, Esstisch für 4 Personen. Private Terrasse mit Liegestühlen und Gartenmöbeln mit Blick auf den denkmalgeschützten Garten. Maßgefertigte Möbel von Handwerkern. Bett 180 cm, Klimaanlage, zwei TVs (Salon + Schlafzimmer), Regendusche, separates WC, Espressomaschine, Filterkaraffe.`,
          es: `Suite de 50 m² con un confort único y exclusivo. Gran salón con sofá, sillón y mesa de centro, mesa de comedor para 4 cubiertos. Terraza privada con tumbonas y mobiliario de jardín frente al jardín notable catalogado. Mobiliario a medida por artesanos. Cama de 180 cm, aire acondicionado, dos TV (salón + dormitorio), ducha italiana, WC separado, cafetera espresso, jarra filtrada.`,
          it: `Suite di 50 m² con comfort unico ed esclusivo. Grande soggiorno con divano, poltrona e tavolino, tavolo da pranzo per 4 coperti. Terrazza privata con sdraio e mobili da giardino affacciati sul giardino classificato notevole. Arredamento su misura da artigiani. Letto 180 cm, aria condizionata, due TV (soggiorno + camera), doccia italiana, WC separato, macchina per espresso, caraffa filtrata.`,
        },
      },
    };
    const upd = db.prepare('UPDATE room_categories SET name=?, description=? WHERE slug=?');
    Object.entries(CAT_DATA).forEach(([slug, data]) => {
      upd.run(JSON.stringify(data.name), JSON.stringify(data.description), slug);
    });
  }
}

// Migration: room photos table
try {
  db.exec(`CREATE TABLE IF NOT EXISTS room_photos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id    INTEGER NOT NULL,
    filename   TEXT    NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  )`);
} catch(e) {}
try { db.exec("ALTER TABLE room_photos ADD COLUMN category TEXT DEFAULT 'general'"); } catch(e) {}
try { db.exec("ALTER TABLE reservations ADD COLUMN breakfast INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE reservations ADD COLUMN arrival_time TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE reservations ADD COLUMN payment_mode TEXT DEFAULT 'online'"); } catch(e) {}
try { db.exec("ALTER TABLE reservations ADD COLUMN stripe_payment_intent_id TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE reservations ADD COLUMN stripe_status TEXT"); } catch(e) {}

// Migration: reviews (livre d'or)
try {
  db.exec(`CREATE TABLE IF NOT EXISTS reviews (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    rating     INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment    TEXT    NOT NULL,
    consent    INTEGER NOT NULL DEFAULT 0,
    approved   INTEGER NOT NULL DEFAULT 0,
    source     TEXT    NOT NULL DEFAULT 'qr',
    created_at TEXT    DEFAULT (datetime('now'))
  )`);
} catch(e) {}

// Migration: clear room descriptions (now stored in room_categories.description)
{
  const hasDesc = db.prepare("SELECT COUNT(*) c FROM rooms WHERE description IS NOT NULL").get().c;
  if (hasDesc) db.prepare("UPDATE rooms SET description = NULL").run();
}

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
