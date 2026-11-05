import { hashPassword, type AuthUser } from './auth';
import { config } from './config';
import { initChatTables } from './chat';
import { migrate, now, sql } from './db';
import { setWatch } from './catalog';
import { checkout, conductorAccept, conductorDeliver, conductorOnTheWay, conductorPickup, vendorAccept, vendorReady } from './orders';
import { updateLocation } from './conductors';
import { normalizeProductName } from '../shared/format';
import type { Point, VehicleType } from '../shared/types';

const CATEGORIES = ['Bakery', 'Groceries', 'Fresh Produce', 'Dairy & Eggs', 'Drinks', 'Ready Meals', 'Home & Kitchen'];
const DEMO_PASSWORD = 'demo1234';

interface UserInput {
  role: 'admin' | 'vendor' | 'buyer' | 'conductor' | 'gp';
  status: 'active' | 'pending';
  name: string;
  email: string;
  password: string;
  phone?: string;
  address?: string;
  point?: Point;
}

function insertUser(input: UserInput): number {
  const info = sql.run(
    `INSERT INTO users (role, status, name, email, phone, password_hash, address, lat, lng, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.role,
    input.status,
    input.name,
    input.email,
    input.phone ?? null,
    hashPassword(input.password),
    input.address ?? null,
    input.point?.lat ?? null,
    input.point?.lng ?? null,
    now(),
  );
  return Number(info.lastInsertRowid);
}

function insertStore(ownerId: number, name: string, description: string, address: string, point: Point, phone: string): number {
  const info = sql.run(
    `INSERT INTO stores (owner_id, name, description, address, lat, lng, phone, sells_until, plan, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'), 'trial', ?)`,
    ownerId,
    name,
    description,
    address,
    point.lat,
    point.lng,
    phone,
    now(),
  );
  return Number(info.lastInsertRowid);
}

interface ConductorInput {
  name: string;
  email: string;
  phone: string;
  vehicle: VehicleType;
  point: Point | null;
  online: boolean;
  status: 'active' | 'pending';
}

function insertConductor(input: ConductorInput): number {
  const userId = insertUser({
    role: 'conductor',
    status: input.status,
    name: input.name,
    email: input.email,
    password: DEMO_PASSWORD,
    phone: input.phone,
  });
  sql.run(
    `INSERT INTO conductors (user_id, vehicle, is_online, lat, lng, location_updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    userId,
    input.vehicle,
    input.online ? 1 : 0,
    input.point?.lat ?? null,
    input.point?.lng ?? null,
    input.point ? now() : null,
  );
  return userId;
}

function authUser(id: number): AuthUser {
  const user = sql.get<AuthUser>('SELECT id, role, name, email, status FROM users WHERE id = ?', id);
  if (!user) throw new Error(`Demo user ${id} is missing`);
  return user;
}

function ensureCategories(): void {
  for (const name of CATEGORIES) sql.run('INSERT OR IGNORE INTO categories (name) VALUES (?)', name);
}

function ensureAdmin(): void {
  if (sql.get('SELECT id FROM users WHERE email = ?', config.adminEmail)) return;
  insertUser({
    role: 'admin',
    status: 'active',
    name: 'Marche Bou Makk Admin',
    email: config.adminEmail,
    password: config.adminPassword,
  });
}

function ensureProduct(name: string, categoryName: string, description: string): number {
  const normalized = normalizeProductName(name);
  const existing = sql.get<{ id: number }>('SELECT id FROM products WHERE normalized_name = ?', normalized);
  if (existing) return existing.id;
  const category = sql.get<{ id: number }>('SELECT id FROM categories WHERE name = ?', categoryName);
  const info = sql.run(
    `INSERT INTO products (name, normalized_name, description, category_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    name,
    normalized,
    description,
    category?.id ?? null,
    now(),
    now(),
  );
  return Number(info.lastInsertRowid);
}

function productIdByName(name: string): number {
  const row = sql.get<{ id: number }>('SELECT id FROM products WHERE normalized_name = ?', normalizeProductName(name));
  if (!row) throw new Error(`Demo product ${name} is missing`);
  return row.id;
}

function offerIdFor(storeId: number, productName: string): number {
  const row = sql.get<{ id: number }>(
    `SELECT o.id FROM offers o JOIN products p ON p.id = o.product_id
     WHERE o.store_id = ? AND p.normalized_name = ?`,
    storeId,
    normalizeProductName(productName),
  );
  if (!row) throw new Error(`Demo offer ${productName} is missing`);
  return row.id;
}

function seedDemo(): void {
  // Demo positions are offsets from the configured market center (Dakar by default).
  const at = (north: number, east: number): Point => ({
    lat: config.center.lat + north,
    lng: config.center.lng + east,
  });

  ensureAdmin();

  const bakeryOwner = insertUser({
    role: 'vendor',
    status: 'active',
    name: 'Mamadou Ndiaye',
    email: 'vendor1@market.local',
    password: DEMO_PASSWORD,
    phone: '+221 77 100 00 01',
  });
  const bakery = insertStore(
    bakeryOwner,
    'Boulangerie Teranga',
    'Pain frais chaque matin, baguettes et viennoiseries.',
    'Médina, Rue 10 x Blaise Diagne, Dakar',
    at(-0.008, -0.012),
    '+221 77 100 00 01',
  );
  const grocerOwner = insertUser({
    role: 'vendor',
    status: 'active',
    name: 'Fatou Sow',
    email: 'vendor2@market.local',
    password: DEMO_PASSWORD,
    phone: '+221 76 200 00 02',
  });
  const grocer = insertStore(
    grocerOwner,
    'Épicerie Keur Fatou',
    'Fruits et légumes frais, produits laitiers et épicerie du quotidien.',
    'Liberté 6, Villa 45, Dakar',
    at(-0.015, 0.012),
    '+221 76 200 00 02',
  );
  const kitchenOwner = insertUser({
    role: 'vendor',
    status: 'pending',
    name: 'Ibrahima Fall',
    email: 'vendor3@market.local',
    password: DEMO_PASSWORD,
    phone: '+221 70 300 00 03',
  });
  insertStore(
    kitchenOwner,
    'Keur Yaye Cuisine',
    'Plats cuisinés maison, en attente de validation.',
    'Mermoz, Dakar',
    at(-0.02, -0.008),
    '+221 70 300 00 03',
  );

  const awaPoint = at(0.01, 0.01);
  const moussaPoint = at(0.012, -0.024);
  const awa = insertUser({
    role: 'buyer',
    status: 'active',
    name: 'Awa Diallo',
    email: 'buyer@market.local',
    password: DEMO_PASSWORD,
    phone: '+221 78 400 00 04',
    address: 'Sacré-Cœur 3, Villa 12, Dakar',
    point: awaPoint,
  });
  const moussa = insertUser({
    role: 'buyer',
    status: 'active',
    name: 'Moussa Diop',
    email: 'buyer2@market.local',
    password: DEMO_PASSWORD,
    phone: '+221 77 500 00 05',
    address: 'Ouakam, près de la mosquée, Dakar',
    point: moussaPoint,
  });

  const ousmane = insertConductor({
    name: 'Ousmane Ba',
    email: 'conductor@market.local',
    phone: '+221 75 600 00 06',
    vehicle: 'moto',
    point: at(-0.006, -0.01),
    online: true,
    status: 'active',
  });
  const aminata = insertConductor({
    name: 'Aminata Sarr',
    email: 'conductor2@market.local',
    phone: '+221 76 700 00 07',
    vehicle: 'bicycle',
    point: at(-0.013, 0.01),
    online: true,
    status: 'active',
  });
  insertConductor({
    name: 'Cheikh Gueye',
    email: 'conductor3@market.local',
    phone: '+221 70 800 00 08',
    vehicle: 'car',
    point: null,
    online: false,
    status: 'pending',
  });

  const gpUser = insertUser({
    role: 'gp',
    status: 'active',
    name: 'Global Partner',
    email: 'gp@market.local',
    password: DEMO_PASSWORD,
    phone: '+221 70 900 00 09',
    address: 'Dakar, Senegal',
  });
  sql.run(
    `INSERT INTO gp_profiles (user_id, country, international_phone, senegal_phone, dropoff_address, dropoff_lat, dropoff_lng) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    gpUser,
    'Senegal',
    '+33 6 12 34 56 78',
    '+221 70 900 00 09',
    'Dakar, Senegal',
    config.center.lat,
    config.center.lng,
  );

  // Prices are in FCFA.
  const catalog: { store: number; name: string; category: string; description: string; price: number; stock: number }[] = [
    { store: bakery, name: 'Pain baguette', category: 'Bakery', description: 'Baguette croustillante, cuite sur place.', price: 150, stock: 80 },
    { store: bakery, name: 'Croissant', category: 'Bakery', description: 'Croissant pur beurre, bien feuilleté.', price: 300, stock: 2 },
    { store: bakery, name: 'Pain au chocolat', category: 'Bakery', description: 'Viennoiserie au chocolat noir.', price: 350, stock: 0 },
    { store: bakery, name: 'Pain complet', category: 'Bakery', description: 'Pain complet au levain, 500 g.', price: 500, stock: 12 },
    { store: grocer, name: 'Pain baguette', category: 'Bakery', description: 'Baguette croustillante, cuite sur place.', price: 170, stock: 60 },
    { store: grocer, name: 'Pain complet', category: 'Bakery', description: 'Pain complet au levain, 500 g.', price: 550, stock: 6 },
    { store: grocer, name: 'Tomates (1 kg)', category: 'Fresh Produce', description: 'Tomates fraîches, 1 kg.', price: 800, stock: 30 },
    { store: grocer, name: 'Oignons (1 kg)', category: 'Fresh Produce', description: 'Oignons jaunes, 1 kg.', price: 600, stock: 35 },
    { store: grocer, name: 'Mangues (1 kg)', category: 'Fresh Produce', description: 'Mangues de saison, 1 kg.', price: 1200, stock: 25 },
    { store: grocer, name: 'Bananes (1 kg)', category: 'Fresh Produce', description: 'Bananes bien mûres, 1 kg.', price: 900, stock: 40 },
    { store: grocer, name: 'Oeufs (plateau de 30)', category: 'Dairy & Eggs', description: 'Plateau de 30 œufs frais.', price: 2500, stock: 18 },
    { store: grocer, name: 'Lait frais (1 L)', category: 'Dairy & Eggs', description: 'Lait frais pasteurisé, 1 litre.', price: 800, stock: 50 },
    { store: grocer, name: 'Bissap (1 L)', category: 'Drinks', description: 'Jus de bissap maison, 1 litre.', price: 1000, stock: 20 },
    { store: grocer, name: 'Eau minérale (1,5 L)', category: 'Drinks', description: 'Bouteille d’eau minérale de 1,5 litre.', price: 350, stock: 60 },
  ];
  for (const item of catalog) {
    const productId = ensureProduct(item.name, item.category, item.description);
    sql.run(
      `INSERT INTO offers (product_id, store_id, price_cents, stock, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      productId,
      item.store,
      Math.round(item.price * 100),
      item.stock,
      now(),
      now(),
    );
  }
  setWatch(awa, productIdByName('Pain complet'), true);

  const dropoff = (name: string, phone: string, address: string, point: Point) => ({
    name,
    phone,
    address,
    lat: point.lat,
    lng: point.lng,
  });

  // A delivered order, so the earnings and history views have data.
  const delivered = checkout(authUser(awa), {
    items: [
      { offerId: offerIdFor(bakery, 'Pain baguette'), quantity: 2 },
      { offerId: offerIdFor(bakery, 'Croissant'), quantity: 1 },
    ],
    paymentMethod: 'mobile_money',
    delivery: {
      ...dropoff('Awa Diallo', '+221 78 400 00 04', 'Sacré-Cœur 3, Villa 12, Dakar', awaPoint),
      notes: 'Sonnez deux fois',
    },
  });
  const deliveredId = delivered.orders[0].id;
  vendorAccept(authUser(bakeryOwner), deliveredId);
  vendorReady(authUser(bakeryOwner), deliveredId);
  conductorAccept(authUser(aminata), deliveredId);
  const bakeryStore = sql.get<{ lat: number; lng: number }>('SELECT lat, lng FROM stores WHERE id = ?', bakery);
  updateLocation(authUser(aminata).id, { lat: bakeryStore!.lat, lng: bakeryStore!.lng });
  conductorPickup(authUser(aminata), deliveredId);
  conductorOnTheWay(authUser(aminata), deliveredId);
  updateLocation(authUser(aminata).id, { lat: awaPoint.lat, lng: awaPoint.lng });
  conductorDeliver(authUser(aminata), deliveredId, '/uploads/proof.jpg');

  // An order already on the road, paid in cash on delivery.
  const onRoad = checkout(authUser(moussa), {
    items: [
      { offerId: offerIdFor(grocer, 'Tomates (1 kg)'), quantity: 2 },
      { offerId: offerIdFor(grocer, 'Lait frais (1 L)'), quantity: 1 },
    ],
    paymentMethod: 'cash',
    delivery: dropoff('Moussa Diop', '+221 77 500 00 05', 'Ouakam, près de la mosquée, Dakar', moussaPoint),
  });
  const onRoadId = onRoad.orders[0].id;
  vendorAccept(authUser(grocerOwner), onRoadId);
  vendorReady(authUser(grocerOwner), onRoadId);
  conductorAccept(authUser(ousmane), onRoadId);
  const grocerStore = sql.get<{ lat: number; lng: number }>('SELECT lat, lng FROM stores WHERE id = ?', grocer);
  updateLocation(authUser(ousmane).id, { lat: grocerStore!.lat, lng: grocerStore!.lng });
  conductorPickup(authUser(ousmane), onRoadId);
  conductorOnTheWay(authUser(ousmane), onRoadId);

  // A new order waiting for the store to confirm.
  checkout(authUser(awa), {
    items: [
      { offerId: offerIdFor(grocer, 'Oeufs (plateau de 30)'), quantity: 1 },
      { offerId: offerIdFor(grocer, 'Pain complet'), quantity: 1 },
    ],
    paymentMethod: 'mobile_money',
    delivery: dropoff('Awa Diallo', '+221 78 400 00 04', 'Sacré-Cœur 3, Villa 12, Dakar', awaPoint),
  });

  // An accepted order that is still open for a conductor to claim.
  const open = checkout(authUser(moussa), {
    items: [{ offerId: offerIdFor(bakery, 'Pain complet'), quantity: 1 }],
    paymentMethod: 'mobile_money',
    delivery: dropoff('Moussa Diop', '+221 77 500 00 05', 'Ouakam, près de la mosquée, Dakar', moussaPoint),
  });
  vendorAccept(authUser(bakeryOwner), open.orders[0].id);
}

export function initDatabase(): void {
  migrate();
  initChatTables();
  ensureCategories();
  const count = sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
  if (count === 0 && config.seedDemo) {
    seedDemo();
    console.log(
      `Demo data created. Admin: ${config.adminEmail} / ${config.adminPassword}. Demo accounts (buyer@, vendor1@, conductor@ ...market.local): demo1234`,
    );
    return;
  }
  ensureAdmin();
}
