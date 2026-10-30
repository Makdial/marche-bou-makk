import fs from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { config } from './config';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('buyer', 'vendor', 'conductor', 'admin', 'gp')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'suspended')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  phone TEXT,
  website TEXT,
  banner_url TEXT,
  open_time TEXT,
  close_time TEXT,
  plan TEXT NOT NULL DEFAULT 'trial',
  sells_until TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conductors (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle TEXT NOT NULL DEFAULT 'moto',
  address TEXT,
  is_online INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lng REAL,
  location_updated_at TEXT
);
CREATE TABLE IF NOT EXISTS gp_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  country TEXT,
  international_phone TEXT,
  senegal_phone TEXT,
  dropoff_address TEXT,
  dropoff_lat REAL,
  dropoff_lng REAL
);
CREATE TABLE IF NOT EXISTS gp_shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gp_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  sender_phone TEXT NOT NULL,
  receiver_name TEXT NOT NULL,
  receiver_phone TEXT NOT NULL,
  photo_url TEXT,
  weight_kg REAL NOT NULL,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered',
  proof_photo_url TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  description TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  image_url TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active INTEGER NOT NULL DEFAULT 1,
  image_url TEXT,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_id, store_id)
);
CREATE TABLE IF NOT EXISTS watches (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkout_id TEXT NOT NULL,
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  conductor_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  delivery_fee_cents INTEGER NOT NULL,
  store_transport_cents INTEGER NOT NULL DEFAULT 0,
  commission_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  arrived_pickup_at TEXT,
  arrived_dropoff_at TEXT,
  delivery_photo_url TEXT,
  distance_km REAL NOT NULL DEFAULT 0,
  dropoff_name TEXT NOT NULL,
  dropoff_phone TEXT,
  dropoff_address TEXT NOT NULL,
  dropoff_lat REAL NOT NULL,
  dropoff_lng REAL NOT NULL,
  dropoff_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_conductor ON orders(conductor_id, status);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_id);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  message_key TEXT,
  params TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL,
  recipients INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function migrate(): void {
  // Migrate users table CHECK constraint to include 'gp' role (recreate if needed).
  const userSchema = sql.get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")?.sql ?? '';
  if (userSchema && !userSchema.includes("'gp'")) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK (role IN ('buyer', 'vendor', 'conductor', 'admin', 'gp')),
      status TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      address TEXT,
      lat REAL,
      lng REAL,
      created_at TEXT NOT NULL
    )`);
    db.exec('INSERT INTO users_new (id, role, status, name, email, phone, password_hash, address, lat, lng, created_at) SELECT id, role, status, name, email, phone, password_hash, address, lat, lng, created_at FROM users');
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_new RENAME TO users');
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.exec(SCHEMA);
  const columns = sql.all<{ name: string }>('PRAGMA table_info(order_events)').map((column) => column.name);
  if (!columns.includes('message_key')) db.exec('ALTER TABLE order_events ADD COLUMN message_key TEXT');
  if (!columns.includes('params')) db.exec('ALTER TABLE order_events ADD COLUMN params TEXT');

  const storeCols = sql.all<{ name: string }>('PRAGMA table_info(stores)').map((c) => c.name);
  if (!storeCols.includes('banner_url')) db.exec('ALTER TABLE stores ADD COLUMN banner_url TEXT');
  if (!storeCols.includes('website')) db.exec('ALTER TABLE stores ADD COLUMN website TEXT');
  if (!storeCols.includes('open_time')) db.exec('ALTER TABLE stores ADD COLUMN open_time TEXT');
  if (!storeCols.includes('close_time')) db.exec('ALTER TABLE stores ADD COLUMN close_time TEXT');
  if (!storeCols.includes('plan')) db.exec("ALTER TABLE stores ADD COLUMN plan TEXT NOT NULL DEFAULT 'trial'");
  if (!storeCols.includes('sells_until')) db.exec('ALTER TABLE stores ADD COLUMN sells_until TEXT');

  const offerCols = sql.all<{ name: string }>('PRAGMA table_info(offers)').map((c) => c.name);
  if (!offerCols.includes('image_url')) db.exec('ALTER TABLE offers ADD COLUMN image_url TEXT');
  if (!offerCols.includes('description')) db.exec('ALTER TABLE offers ADD COLUMN description TEXT');

  const orderCols = sql.all<{ name: string }>('PRAGMA table_info(orders)').map((c) => c.name);
  if (!orderCols.includes('store_transport_cents')) db.exec('ALTER TABLE orders ADD COLUMN store_transport_cents INTEGER NOT NULL DEFAULT 0');
  if (!orderCols.includes('arrived_pickup_at')) db.exec('ALTER TABLE orders ADD COLUMN arrived_pickup_at TEXT');
  if (!orderCols.includes('arrived_dropoff_at')) db.exec('ALTER TABLE orders ADD COLUMN arrived_dropoff_at TEXT');
  if (!orderCols.includes('delivery_photo_url')) db.exec('ALTER TABLE orders ADD COLUMN delivery_photo_url TEXT');

  const conductorCols = sql.all<{ name: string }>('PRAGMA table_info(conductors)').map((c) => c.name);
  if (!conductorCols.includes('address')) db.exec('ALTER TABLE conductors ADD COLUMN address TEXT');

  // Give existing stores a 30-day selling window if they do not have one yet.
  db.exec("UPDATE stores SET sells_until = datetime('now', '+30 days'), plan = COALESCE(plan, 'trial') WHERE sells_until IS NULL");
}

export type Param = string | number | bigint | null;

const statements = new Map<string, StatementSync>();

function prepare(text: string): StatementSync {
  let statement = statements.get(text);
  if (!statement) {
    statement = db.prepare(text);
    statements.set(text, statement);
  }
  return statement;
}

export const sql = {
  all<T>(text: string, ...params: Param[]): T[] {
    return prepare(text).all(...params) as unknown as T[];
  },
  get<T>(text: string, ...params: Param[]): T | undefined {
    return prepare(text).get(...params) as unknown as T | undefined;
  },
  run(text: string, ...params: Param[]) {
    return prepare(text).run(...params);
  },
};

export function tx<T>(work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function sqlIn(values: readonly string[]): string {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ');
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

export function now(): string {
  return new Date().toISOString();
}
