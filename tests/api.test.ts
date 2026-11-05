import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { translate } from '../src/shared/i18n';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'marche-test-'));
process.env.SEED_DEMO = 'true';
process.env.NODE_ENV = 'test';

const { initDatabase } = await import('../src/server/seed');
const { createApp } = await import('../src/server/app');

interface Response {
  status: number;
  data: any;
}

let server: Server;
let base = '';

async function api(
  method: string,
  route: string,
  options: { token?: string; body?: unknown; locale?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.locale) headers['X-Locale'] = options.locale;
  const response = await fetch(`${base}${route}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function login(email: string, password = 'demo1234'): Promise<string> {
  const res = await api('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data.token;
}

async function notificationsOf(token: string): Promise<any[]> {
  const res = await api('GET', '/api/notifications?limit=200', { token });
  assert.equal(res.status, 200);
  return res.data.notifications;
}

async function offerId(token: string, productName: string, storeName: string): Promise<number> {
  const search = await api('GET', `/api/products?q=${encodeURIComponent(productName)}`);
  const product = search.data.products.find((item: any) => item.name === productName);
  assert.ok(product, `product ${productName} should exist`);
  const detail = await api('GET', `/api/products/${product.id}`, { token });
  const offer = detail.data.product.offers.find((item: any) => item.storeName === storeName);
  assert.ok(offer, `${productName} should be sold by ${storeName}`);
  return offer.offerId;
}

async function stockOf(token: string, productName: string, storeName: string): Promise<number> {
  const search = await api('GET', `/api/products?q=${encodeURIComponent(productName)}`);
  const product = search.data.products.find((item: any) => item.name === productName);
  const detail = await api('GET', `/api/products/${product.id}`, { token });
  return detail.data.product.offers.find((item: any) => item.storeName === storeName).stock;
}

const deliveryDetails = {
  name: 'Test Buyer',
  phone: '+221 77 123 45 67',
  address: 'Rue 15, Médina, Dakar',
  lat: 14.6937,
  lng: -17.4441,
};

before(async () => {
  initDatabase();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function packageBody(receiverPhone: string) {
  return {
    senderName: 'Fatou Ndiaye',
    senderPhone: '+33 6 12 34 56 78',
    receiverName: 'Receiver Diop',
    receiverPhone,
    receiverAddress: 'Rue 10, Médina, Dakar',
    receiverLat: 14.6937,
    receiverLng: -17.4441,
    weightKg: 4.5,
    priceCents: 1500000,
  };
}

describe('international packages', () => {
  it('moves a package through every step and tells the receiver, the GP and the courier', async () => {
    const admin = await login('admin@market.local', 'admin1234');
    const courierEmail = `courier-${Date.now()}@test.local`;
    const courierRegister = await api('POST', '/api/auth/register', {
      body: { role: 'conductor', name: 'Package Courier', email: courierEmail, password: 'demo1234', phone: '+221 77 400 00 22', vehicle: 'moto' },
    });
    assert.equal(courierRegister.status, 201, JSON.stringify(courierRegister.data));
    const approved = await api('PATCH', `/api/admin/users/${courierRegister.data.user.id}`, { token: admin, body: { status: 'active' } });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    const courier = await login(courierEmail);
    assert.equal((await api('PUT', '/api/conductor/status', { token: courier, body: { isOnline: true } })).status, 200);
    assert.equal((await api('POST', '/api/conductor/location', { token: courier, body: { lat: 14.6928, lng: -17.4467 } })).status, 200);

    const receiverRegister = await api('POST', '/api/auth/register', {
      body: {
        role: 'buyer',
        name: 'Receiver Diop',
        email: `receiver-${Date.now()}@test.local`,
        password: 'demo1234',
        phone: '+221 77 555 00 11',
        address: 'Rue 10, Médina, Dakar',
        lat: 14.6937,
        lng: -17.4441,
      },
    });
    assert.equal(receiverRegister.status, 201, JSON.stringify(receiverRegister.data));
    const receiver = receiverRegister.data.token;

    const gp = await login('gp@market.local');
    const created = await api('POST', '/api/gp/shipments', { token: gp, body: packageBody('77 555 00 11') });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const id: number = created.data.shipment.id;
    assert.equal(created.data.shipment.status, 'registered');
    assert.equal(created.data.shipment.senderPhone, '+33 6 12 34 56 78', 'the GP sees the sender phone');
    assert.ok((await notificationsOf(receiver)).some((item) => item.type === 'package.registered'), 'the receiver is told about the package');

    const shopperList = await api('GET', '/api/packages', { token: receiver });
    assert.equal(shopperList.status, 200);
    const mine = shopperList.data.packages.find((item: any) => item.id === id);
    assert.ok(mine, 'the receiver sees the package, matched by phone number');
    assert.equal(mine.senderPhone, null, 'the receiver never sees the sender phone');
    assert.equal(mine.receiverPhone, null);

    const pickedUp = await api('PATCH', `/api/gp/shipments/${id}`, { token: gp, body: { status: 'picked_up' } });
    assert.equal(pickedUp.status, 200, JSON.stringify(pickedUp.data));
    assert.equal(pickedUp.data.shipment.status, 'picked_up');
    assert.ok((await notificationsOf(receiver)).some((item) => item.type === 'package.pickedUp'));

    const board = await api('GET', '/api/conductor/overview', { token: courier });
    assert.ok(board.data.jobs.some((job: any) => job.kind === 'package' && job.id === id), 'the courier sees the package job');

    const accepted = await api('POST', `/api/conductor/packages/${id}/accept`, { token: courier });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal(accepted.data.package.conductor.name, 'Package Courier');
    assert.ok((await notificationsOf(receiver)).some((item) => item.type === 'package.assigned'));
    assert.ok((await notificationsOf(gp)).some((item) => item.type === 'package.assigned'));

    const again = await api('PATCH', `/api/gp/shipments/${id}`, { token: gp, body: { status: 'picked_up' } });
    assert.equal(again.status, 409, 'a package cannot go back to an earlier step');

    const pickup = await api('POST', `/api/conductor/packages/${id}/pickup`, { token: courier });
    assert.equal(pickup.status, 200, JSON.stringify(pickup.data));
    assert.equal(pickup.data.package.status, 'out_for_delivery');
    assert.ok((await notificationsOf(receiver)).some((item) => item.type === 'package.onTheWay'));

    const early = await api('POST', `/api/conductor/packages/${id}/deliver`, { token: courier, body: { photoUrl: '/uploads/proof.jpg' } });
    assert.equal(early.status, 409, 'the courier must be at the receiver before delivering');

    await api('POST', '/api/conductor/location', { token: courier, body: { lat: 14.6937, lng: -17.4441 } });
    const delivered = await api('POST', `/api/conductor/packages/${id}/deliver`, { token: courier, body: { photoUrl: '/uploads/proof.jpg' } });
    assert.equal(delivered.status, 200, JSON.stringify(delivered.data));
    assert.equal(delivered.data.package.status, 'delivered');
    assert.equal(delivered.data.package.proofPhotoUrl, '/uploads/proof.jpg');
    assert.ok((await notificationsOf(receiver)).some((item) => item.type === 'package.delivered'));

    const finalList = await api('GET', '/api/packages', { token: receiver });
    assert.equal(finalList.data.packages.find((item: any) => item.id === id).status, 'delivered');
    const otherShopper = await api('GET', '/api/packages', { token: await login('buyer@market.local') });
    assert.ok(!otherShopper.data.packages.some((item: any) => item.id === id), 'other shoppers do not see it');
    assert.equal((await api('PUT', '/api/conductor/status', { token: courier, body: { isOnline: false } })).status, 200);
  });

  it('lets the GP hand a package over at the drop-off when no courier is needed', async () => {
    const gp = await login('gp@market.local');
    const created = await api('POST', '/api/gp/shipments', { token: gp, body: packageBody('77 555 00 11') });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const id: number = created.data.shipment.id;
    const pickedUp = await api('PATCH', `/api/gp/shipments/${id}`, { token: gp, body: { status: 'picked_up' } });
    assert.equal(pickedUp.status, 200, JSON.stringify(pickedUp.data));
    const handed = await api('PATCH', `/api/gp/shipments/${id}`, { token: gp, body: { status: 'delivered', proofPhotoUrl: '/uploads/handover.jpg' } });
    assert.equal(handed.status, 200, JSON.stringify(handed.data));
    assert.equal(handed.data.shipment.status, 'delivered');
    const back = await api('PATCH', `/api/gp/shipments/${id}`, { token: gp, body: { status: 'picked_up' } });
    assert.equal(back.status, 409, 'a delivered package cannot be moved back');
  });
});

describe('catalog and multi-vendor offers', () => {
  it('lists one product with offers from several vendors', async () => {
    const res = await api('GET', '/api/products?q=baguette');
    const baguette = res.data.products.find((item: any) => item.name === 'Pain baguette');
    assert.equal(baguette.offerCount, 2);
    assert.ok(baguette.minPriceCents > 0);
  });

  it('blocks a pending vendor from publishing products until approved', async () => {
    const token = await login('vendor3@market.local');
    const res = await api('POST', '/api/vendor/offers', {
      token,
      body: { name: 'Lasagna', priceCents: 900, stock: 5, categoryId: null },
    });
    assert.equal(res.status, 403);
    assert.match(res.data.error, /waiting for admin approval/);
  });

  it('rejects an invalid registration with a readable message', async () => {
    const res = await api('POST', '/api/auth/register', {
      body: { role: 'buyer', name: 'Bad Email', email: 'not-an-email', password: 'secret1' },
    });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /email/);
  });

  it('keeps buyers out of vendor and admin areas', async () => {
    const token = await login('buyer@market.local');
    assert.equal((await api('GET', '/api/vendor/overview', { token })).status, 403);
    assert.equal((await api('GET', '/api/admin/stats', { token })).status, 403);
  });
});

describe('notifications for a specific product', () => {
  it('tells buyers watching a product when a vendor changes its price', async () => {
    const vendorToken = await login('vendor1@market.local');
    const id = await offerId(vendorToken, 'Pain complet', 'Boulangerie Teranga');
    const res = await api('PATCH', `/api/vendor/offers/${id}`, { token: vendorToken, body: { priceCents: 48000 } });
    assert.equal(res.status, 200);
    assert.equal(res.data.offer.priceCents, 48000);

    const buyerToken = await login('buyer@market.local');
    const notes = await notificationsOf(buyerToken);
    const priceNote = notes.find((note) => note.type === 'product.price_changed');
    assert.ok(priceNote, 'watcher should be notified');
    assert.equal(priceNote.titleKey, 'notif.priceChanged.title');
    assert.equal(priceNote.title, 'Price update: Pain complet');
  });

  it('notifies vendors of a product when an admin sends a product alert', async () => {
    const adminToken = await login('admin@market.local', 'admin1234');
    const products = await api('GET', '/api/products?q=Tomates');
    const tomatoes = products.data.products.find((item: any) => item.name === 'Tomates (1 kg)');
    const res = await api('POST', '/api/admin/alerts', {
      token: adminToken,
      body: {
        productId: tomatoes.id,
        title: 'Contrôle des tomates',
        body: 'Merci de confirmer la provenance de vos tomates aujourd’hui.',
        audience: ['vendors', 'buyers', 'conductors'],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.recipients.vendors, 1);
    assert.ok(res.data.recipients.buyers >= 1, 'buyer with an open tomato order should be reached');
    assert.equal(res.data.recipients.conductors, 1, 'conductor on the tomato delivery should be reached');

    const conductorNotes = await notificationsOf(await login('conductor@market.local'));
    const alert = conductorNotes.find((note) => note.type === 'product.alert');
    assert.ok(alert, 'conductor on the tomato delivery should get the alert');
    assert.equal(alert.title, 'Contrôle des tomates');
    assert.equal(alert.titleKey, null, 'admin alerts keep the text that was typed');
    const vendorNotes = await notificationsOf(await login('vendor2@market.local'));
    assert.ok(vendorNotes.some((note) => note.type === 'product.alert'));
  });
});

describe('ordering, delivery and cancellations', () => {
  let grocerOrderId: number;
  let bakeryOrderId: number;
  let handedOverOrderId: number;

  it('splits a cart with two stores into one order per store', async () => {
    const token = await login('buyer2@market.local');
    const baguetteOfferId = await offerId(token, 'Pain baguette', 'Boulangerie Teranga');
    const bananasOfferId = await offerId(token, 'Bananes (1 kg)', 'Épicerie Keur Fatou');
    const items = [
      { offerId: bananasOfferId, quantity: 2 },
      { offerId: baguetteOfferId, quantity: 1 },
    ];

    const quote = await api('POST', '/api/orders/quote', {
      token,
      body: { items, delivery: { lat: deliveryDetails.lat, lng: deliveryDetails.lng } },
    });
    assert.equal(quote.status, 200);
    assert.equal(quote.data.quote.groups.length, 2);
    assert.equal(quote.data.quote.totalCents, quote.data.quote.subtotalCents);

    const stockBefore = await stockOf(token, 'Bananes (1 kg)', 'Épicerie Keur Fatou');
    const res = await api('POST', '/api/orders', {
      token,
      body: { items, paymentMethod: 'mobile_money', delivery: deliveryDetails },
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.orders.length, 2);
    assert.equal(new Set(res.data.orders.map((order: any) => order.store.name)).size, 2);
    grocerOrderId = res.data.orders.find((order: any) => order.store.name === 'Épicerie Keur Fatou').id;
    bakeryOrderId = res.data.orders.find((order: any) => order.store.name === 'Boulangerie Teranga').id;

    const stockAfter = await stockOf(token, 'Bananes (1 kg)', 'Épicerie Keur Fatou');
    assert.equal(stockAfter, stockBefore - 2, 'stock should drop by the ordered quantity');

    const vendorNotes = await notificationsOf(await login('vendor2@market.local'));
    const newOrder = vendorNotes.find((note) => note.type === 'order.new' && note.data.orderId === grocerOrderId);
    assert.ok(newOrder, 'the store should hear about the new order');
    assert.equal(newOrder.titleKey, 'notif.new.title');
    assert.equal(newOrder.params.buyer, 'Moussa');
    assert.equal(newOrder.title, `New order #${grocerOrderId}`);
    const paid = vendorNotes.find((note) => note.type === 'order.paid' && note.data.orderId === grocerOrderId);
    assert.ok(paid, 'the store should hear when an online payment comes in');
    assert.equal(paid.title, `Paid online · Order #${grocerOrderId}`);
  });

  it('restocks items when the buyer cancels a placed order', async () => {
    const token = await login('buyer2@market.local');
    const res = await api('POST', `/api/orders/${bakeryOrderId}/cancel`, { token });
    assert.equal(res.status, 200);
    assert.equal(res.data.order.status, 'cancelled');
    const vendorNotes = await notificationsOf(await login('vendor1@market.local'));
    assert.ok(vendorNotes.some((note) => note.type === 'order.cancelled' && note.data.orderId === bakeryOrderId));
  });

  it('says how many items are left when a cart asks for more than the stock', async () => {
    const token = await login('buyer@market.local');
    const croissantId = await offerId(token, 'Croissant', 'Boulangerie Teranga');
    const left = await stockOf(token, 'Croissant', 'Boulangerie Teranga');
    const res = await api('POST', '/api/orders', {
      token,
      body: { items: [{ offerId: croissantId, quantity: left + 1 }], paymentMethod: 'cash', delivery: deliveryDetails },
    });
    assert.equal(res.status, 409);
    assert.equal(res.data.error, `Only ${left} left of Croissant at Boulangerie Teranga`);
  });

  it('runs the full pickup and drop-off flow and notifies every party', async () => {
    const vendorToken = await login('vendor2@market.local');
    const accepted = await api('POST', `/api/vendor/orders/${grocerOrderId}/accept`, { token: vendorToken });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.order.status, 'preparing');

    const buyerNotes = await notificationsOf(await login('buyer2@market.local'));
    assert.ok(buyerNotes.some((note) => note.type === 'order.accepted' && note.data.orderId === grocerOrderId));

    const aminataToken = await login('conductor2@market.local');
    const aminataNotes = await notificationsOf(aminataToken);
    assert.ok(aminataNotes.some((note) => note.type === 'job.available' && note.data.orderId === grocerOrderId));

    const claimed = await api('POST', `/api/conductor/jobs/${grocerOrderId}/accept`, { token: aminataToken });
    assert.equal(claimed.status, 200, 'a conductor may claim a job once the store accepted it');

    const pickupTooEarly = await api('POST', `/api/conductor/orders/${grocerOrderId}/pickup`, { token: aminataToken });
    assert.equal(pickupTooEarly.status, 409);

    assert.equal((await api('POST', `/api/vendor/orders/${grocerOrderId}/ready`, { token: vendorToken })).status, 200);
    const readyOrder = await api('GET', `/api/orders/${grocerOrderId}`, { token: aminataToken });
    await api('POST', '/api/conductor/location', { token: aminataToken, body: { lat: readyOrder.data.order.store.lat, lng: readyOrder.data.order.store.lng } });
    const pickup = await api('POST', `/api/conductor/orders/${grocerOrderId}/pickup`, { token: aminataToken });
    assert.equal(pickup.status, 200);
    assert.equal(pickup.data.order.status, 'picked_up');
    const deliverTooEarly = await api('POST', `/api/conductor/orders/${grocerOrderId}/deliver`, { token: aminataToken, body: { photoUrl: '/uploads/proof.jpg' } });
    assert.equal(deliverTooEarly.status, 409, 'the driver must start the trip before delivering');
    const onWay = await api('POST', `/api/conductor/orders/${grocerOrderId}/on-the-way`, { token: aminataToken });
    assert.equal(onWay.status, 200, JSON.stringify(onWay.data));
    assert.equal(onWay.data.order.status, 'out_for_delivery');
    const deliveredOrder = await api('GET', `/api/orders/${grocerOrderId}`, { token: aminataToken });
    await api('POST', '/api/conductor/location', { token: aminataToken, body: { lat: deliveredOrder.data.order.dropoff.lat, lng: deliveredOrder.data.order.dropoff.lng } });
    const delivered = await api('POST', `/api/conductor/orders/${grocerOrderId}/deliver`, { token: aminataToken, body: { photoUrl: '/uploads/proof.jpg' } });
    assert.equal(delivered.status, 200);
    assert.equal(delivered.data.order.status, 'delivered');
    assert.equal(delivered.data.order.conductorEarningCents, delivered.data.order.transportFeeCents);

    const overview = await api('GET', '/api/conductor/overview', { token: aminataToken });
    assert.ok(overview.data.stats.deliveriesTotal >= 2);

    for (const [email, type] of [
      ['buyer2@market.local', 'order.delivered'],
      ['vendor2@market.local', 'order.delivered'],
      ['conductor2@market.local', 'order.delivered'],
    ] as const) {
      const notes = await notificationsOf(await login(email));
      assert.ok(notes.some((note) => note.type === type && note.data.orderId === grocerOrderId), `${email} should hear about delivery`);
    }
    const buyerSteps = await notificationsOf(await login('buyer2@market.local'));
    for (const type of ['order.picked_up', 'order.on_the_way']) {
      assert.ok(buyerSteps.some((note) => note.type === type && note.data.orderId === grocerOrderId), `buyer should hear about ${type}`);
    }
  });

  it('records each order step as a translation key with its English text', async () => {
    const buyerToken = await login('buyer2@market.local');
    const order = (await api('GET', `/api/orders/${grocerOrderId}`, { token: buyerToken })).data.order;
    assert.deepEqual(
      order.events.map((event: any) => event.messageKey),
      ['event.placed', 'event.accepted', 'event.assigned', 'event.ready', 'event.pickedUp', 'event.onTheWay', 'event.delivered'],
    );
    const pickedUp = order.events.find((event: any) => event.messageKey === 'event.pickedUp');
    assert.deepEqual(pickedUp.params, { name: 'Aminata Sarr' });
    assert.equal(pickedUp.message, 'Aminata Sarr picked up the order from the store.');
    const onTheWay = order.events.find((event: any) => event.messageKey === 'event.onTheWay');
    assert.equal(onTheWay.message, 'Aminata Sarr is on the way to the customer.');

    const accepted = (await notificationsOf(buyerToken)).find(
      (note) => note.type === 'order.accepted' && note.data.orderId === grocerOrderId,
    );
    assert.ok(accepted, 'buyer should hear that the store accepted the order');
    assert.equal(accepted.titleKey, 'notif.orderUpdate.title');
    assert.equal(accepted.bodyKey, 'event.accepted');
    assert.deepEqual(accepted.params, { id: grocerOrderId, status: '@status.preparing' });
    assert.equal(accepted.title, `Order #${grocerOrderId} · Preparing`);
    assert.equal(accepted.body, 'Store accepted the order and started preparing it.');
    assert.equal('i18n' in accepted.data, false, 'translation details stay out of the data');
  });

  it('lets the store hand a ready order to the driver before the driver starts the trip', async () => {
    const buyerToken = await login('buyer@market.local');
    const bananasId = await offerId(buyerToken, 'Bananes (1 kg)', 'Épicerie Keur Fatou');
    const placed = await api('POST', '/api/orders', {
      token: buyerToken,
      body: { items: [{ offerId: bananasId, quantity: 1 }], paymentMethod: 'cash', delivery: deliveryDetails },
    });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    handedOverOrderId = placed.data.orders[0].id;

    const vendorToken = await login('vendor2@market.local');
    const driverToken = await login('conductor2@market.local');
    assert.equal((await api('POST', `/api/vendor/orders/${handedOverOrderId}/accept`, { token: vendorToken })).status, 200);
    assert.equal((await api('POST', `/api/vendor/orders/${handedOverOrderId}/picked-up`, { token: vendorToken })).status, 409, 'the order is not ready yet');
    assert.equal((await api('POST', `/api/vendor/orders/${handedOverOrderId}/ready`, { token: vendorToken })).status, 200);
    assert.equal((await api('POST', `/api/vendor/orders/${handedOverOrderId}/picked-up`, { token: vendorToken })).status, 409, 'a driver must accept the job first');
    assert.equal((await api('POST', `/api/conductor/jobs/${handedOverOrderId}/accept`, { token: driverToken })).status, 200);
    const storeSpot = (await api('GET', `/api/orders/${handedOverOrderId}`, { token: driverToken })).data.order.store;
    await api('POST', '/api/conductor/location', { token: driverToken, body: { lat: storeSpot.lat, lng: storeSpot.lng } });
    const seenByDriver = await api('GET', `/api/orders/${handedOverOrderId}`, { token: driverToken });
    assert.equal(seenByDriver.data.order.conductor.lat, storeSpot.lat, 'the driver should see their own position on the order');

    const driverInfo = seenByDriver.data.order.conductor;
    assert.ok(driverInfo.phone, 'the driver should have a phone number on file');
    assert.equal(typeof seenByDriver.data.order.store.ownerId, 'number', 'the driver can open a chat with the store');
    const vendorView = (await api('GET', `/api/orders/${handedOverOrderId}`, { token: vendorToken })).data.order;
    assert.equal(vendorView.conductor.lat, storeSpot.lat, 'the vendor should see where the driver is');
    assert.equal(vendorView.conductor.phone, driverInfo.phone, 'the vendor should be able to call the driver');
    assert.equal(vendorView.dropoff, null, 'the vendor must not see the customer address');
    const assignedNoteFor = async (token: string) =>
      (await notificationsOf(token)).find((note) => note.type === 'order.assigned' && note.data.orderId === handedOverOrderId);
    const buyerHeard = await assignedNoteFor(buyerToken);
    const vendorHeard = await assignedNoteFor(vendorToken);
    assert.ok(buyerHeard && vendorHeard, 'the buyer and the vendor should both hear which driver accepted');
    for (const note of [buyerHeard, vendorHeard]) {
      assert.equal(note.bodyKey, 'notif.driverAssigned');
      assert.equal(note.params.name, 'Aminata Sarr');
      assert.equal(note.params.phone, driverInfo.phone);
      assert.equal(note.params.vehicle, `@vehicle.${driverInfo.vehicle}`);
      assert.ok(note.body.startsWith('Aminata Sarr ('), note.body);
      assert.ok(note.body.endsWith(`Phone: ${driverInfo.phone}.`), note.body);
    }
    assert.ok(
      Math.abs(Date.parse(buyerHeard.createdAt) - Date.parse(vendorHeard.createdAt)) < 1000,
      'the buyer and the vendor should get the driver details at the same moment',
    );

    const handed = await api('POST', `/api/vendor/orders/${handedOverOrderId}/picked-up`, { token: vendorToken });
    assert.equal(handed.status, 200, JSON.stringify(handed.data));
    assert.equal(handed.data.order.status, 'picked_up');
    assert.ok(handed.data.order.pickedUpAt, 'the pickup time should be recorded');
    assert.ok(
      (await notificationsOf(buyerToken)).some((note) => note.type === 'order.picked_up' && note.data.orderId === handedOverOrderId),
      'buyer should hear the order was picked up',
    );
    assert.ok(
      (await notificationsOf(driverToken)).some((note) => note.type === 'order.picked_up' && note.data.orderId === handedOverOrderId),
      'driver should hear the store handed over the order',
    );

    assert.equal((await api('POST', `/api/conductor/orders/${handedOverOrderId}/pickup`, { token: driverToken })).status, 409, 'the order is already picked up');
    const onWay = await api('POST', `/api/conductor/orders/${handedOverOrderId}/on-the-way`, { token: driverToken });
    assert.equal(onWay.status, 200, JSON.stringify(onWay.data));
    assert.equal(onWay.data.order.status, 'out_for_delivery');
    assert.ok(
      (await notificationsOf(buyerToken)).some((note) => note.type === 'order.on_the_way' && note.data.orderId === handedOverOrderId),
      'buyer should hear the driver is on the way',
    );
  });

  it('asks the store to confirm cash only after a cash delivery', async () => {
    const driverToken = await login('conductor2@market.local');
    const vendorToken = await login('vendor2@market.local');
    const before = await api('GET', `/api/orders/${handedOverOrderId}`, { token: driverToken });
    await api('POST', '/api/conductor/location', { token: driverToken, body: { lat: before.data.order.dropoff.lat, lng: before.data.order.dropoff.lng } });
    const delivered = await api('POST', `/api/conductor/orders/${handedOverOrderId}/deliver`, { token: driverToken, body: { photoUrl: '/uploads/proof.jpg' } });
    assert.equal(delivered.status, 200, JSON.stringify(delivered.data));
    assert.equal(delivered.data.order.status, 'delivered');

    const cashNote = (await notificationsOf(vendorToken)).find((note) => note.type === 'order.delivered' && note.data.orderId === handedOverOrderId);
    assert.equal(cashNote.bodyKey, 'notif.cashToConfirm.body');
    assert.match(cashNote.body, /collected .+ in cash/);

    const confirmed = await api('POST', `/api/vendor/orders/${handedOverOrderId}/cash-received`, { token: vendorToken });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.ok(confirmed.data.order.cashReceivedAt, 'the store confirmation should be recorded');
    assert.equal(confirmed.data.order.events.at(-1).messageKey, 'event.cashReceived');
    assert.equal((await api('POST', `/api/vendor/orders/${handedOverOrderId}/cash-received`, { token: vendorToken })).status, 409, 'cash is confirmed only once');
    assert.ok(
      (await notificationsOf(driverToken)).some((note) => note.type === 'order.cash_received' && note.data.orderId === handedOverOrderId),
      'driver should hear the store confirmed the cash',
    );
    assert.equal(
      (await api('POST', `/api/vendor/orders/${grocerOrderId}/cash-received`, { token: vendorToken })).status,
      409,
      'an online payment has no cash to confirm',
    );
  });

  it('lets a driver attach a delivery photo, but not a shopper', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    const upload = (token: string) =>
      fetch(`${base}/api/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` },
        body: png,
      });
    const driverUpload = await upload(await login('conductor2@market.local'));
    assert.equal(driverUpload.status, 201);
    assert.match((await driverUpload.json()).url, /^\/uploads\/.+\.png$/);
    assert.equal((await upload(await login('buyer@market.local'))).status, 403);
  });

  it('keeps the customer address away from vendors', async () => {
    const token = await login('vendor2@market.local');
    const res = await api('GET', '/api/vendor/orders?scope=all', { token });
    const order = res.data.orders.find((item: any) => item.id === grocerOrderId);
    assert.equal(order.dropoff, null);
    assert.equal(order.buyer.name, 'Moussa');
    assert.equal(order.buyer.phone, null);
    assert.ok(order.vendorPayoutCents > 0);
  });

  it('stops a conductor who is on a delivery from taking another job', async () => {
    const ousmaneToken = await login('conductor@market.local');
    const overview = await api('GET', '/api/conductor/overview', { token: ousmaneToken });
    assert.ok(overview.data.active, 'Ousmane should have an active delivery from the seed');

    const moussaOrders = await api('GET', '/api/orders', { token: await login('buyer2@market.local') });
    const openJob = moussaOrders.data.orders.find((order: any) => order.status === 'preparing');
    assert.ok(openJob, 'an accepted bakery order should still be open for a conductor');

    const claim = await api('POST', `/api/conductor/jobs/${openJob.id}/accept`, { token: ousmaneToken });
    assert.equal(claim.status, 409);
    assert.match(claim.data.error, /active delivery/);

    const free = await api('GET', '/api/conductor/overview', { token: await login('conductor2@market.local') });
    assert.ok(free.data.jobs.some((job: any) => job.id === openJob.id), 'a free conductor nearby should see the open job');
  });

  it('streams new notifications over server-sent events', async () => {
    const buyerToken = await login('buyer@market.local');
    const awaOrders = await api('GET', '/api/orders', { token: buyerToken });
    const pending = awaOrders.data.orders.find((order: any) => order.status === 'placed');
    assert.ok(pending, 'Awa should have a placed order from the seed');

    const controller = new AbortController();
    const stream = await fetch(`${base}/api/notifications/stream?token=${buyerToken}`, { signal: controller.signal });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const received = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes('"type":"order.accepted"')) return buffer;
      }
    })();

    const vendorToken = await login('vendor2@market.local');
    const accepted = await api('POST', `/api/vendor/orders/${pending.id}/accept`, { token: vendorToken });
    assert.equal(accepted.status, 200);

    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
    const text = await Promise.race([received, timeout]);
    controller.abort();
    assert.ok(text && text.includes('event: notification'), 'buyer should receive the event live');
  });
});

describe('admin dashboard', () => {
  it('approves a pending vendor, who can then publish products', async () => {
    const adminToken = await login('admin@market.local', 'admin1234');
    const users = await api('GET', '/api/admin/users?status=pending', { token: adminToken });
    const pendingVendor = users.data.users.find((user: any) => user.email === 'vendor3@market.local');
    assert.ok(pendingVendor);

    const approved = await api('PATCH', `/api/admin/users/${pendingVendor.id}`, {
      token: adminToken,
      body: { status: 'active' },
    });
    assert.equal(approved.status, 200);

    const vendorToken = await login('vendor3@market.local');
    const created = await api('POST', '/api/vendor/offers', {
      token: vendorToken,
      body: { name: 'Ceebu jën', priceCents: 250000, stock: 5, description: 'Riz au poisson, portion individuelle.' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.productCreated, true);

    const notes = await notificationsOf(vendorToken);
    assert.ok(notes.some((note) => note.type === 'account.approved'));
  });

  it('dashboard stats count orders, revenue and online conductors', async () => {
    const adminToken = await login('admin@market.local', 'admin1234');
    const res = await api('GET', '/api/admin/stats', { token: adminToken });
    assert.equal(res.status, 200);
    assert.ok(res.data.stats.deliveredCount >= 2);
    assert.ok(res.data.stats.gmvCents > 0);
    assert.ok(res.data.stats.onlineConductors >= 1);
    assert.equal(res.data.stats.lastSevenDays.length, 7);
  });

  it('auto-dispatches open jobs to the nearest free conductor', async () => {
    const adminToken = await login('admin@market.local', 'admin1234');
    const res = await api('POST', '/api/admin/dispatch', { token: adminToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.assigned, 1, 'only Aminata is free, so exactly one job is assigned');
    assert.equal(res.data.unassigned, 1, 'the other open job waits for a free conductor');

    const aminata = await api('GET', '/api/conductor/overview', { token: await login('conductor2@market.local') });
    assert.ok(aminata.data.active, 'Aminata should now hold the dispatched job');
  });
});

describe('maps', () => {
  it('publishes approved stores with coordinates for shoppers', async () => {
    const res = await api('GET', '/api/map/stores');
    assert.equal(res.status, 200);
    assert.ok(res.data.stores.length >= 2);
    assert.ok(res.data.stores.every((store: any) => typeof store.lat === 'number' && typeof store.lng === 'number'));
  });

  it('gives admins live positions for stores, conductors and open orders', async () => {
    const res = await api('GET', '/api/admin/map', { token: await login('admin@market.local', 'admin1234') });
    assert.equal(res.status, 200);
    assert.ok(res.data.stores.length >= 2);
    assert.ok(res.data.conductors.some((conductor: any) => conductor.busy));
    assert.ok(res.data.orders.length >= 1);
  });

  it('shows vendors the conductors heading to their store, without customer addresses', async () => {
    const res = await api('GET', '/api/vendor/map', { token: await login('vendor2@market.local') });
    assert.equal(res.status, 200);
    assert.ok(res.data.store.lat);
    assert.ok(res.data.conductors.length >= 1);
    assert.equal(JSON.stringify(res.data).includes('dropoff'), false);
  });

  it('keeps the admin map away from shoppers', async () => {
    const res = await api('GET', '/api/admin/map', { token: await login('buyer@market.local') });
    assert.equal(res.status, 403);
  });
});

describe('public settings', () => {
  it('exposes the FCFA currency and Dakar as the default map center', async () => {
    const res = await api('GET', '/api/settings');
    assert.equal(res.status, 200);
    assert.equal(res.data.settings.currency, 'XOF');
    assert.ok(Math.abs(res.data.settings.center.lat - 14.6928) < 0.01);
    assert.ok(Math.abs(res.data.settings.center.lng + 17.4467) < 0.01);
  });
});

describe('localized responses', () => {
  const wrongPassword = { email: 'buyer@market.local', password: 'not-the-password' };

  it('answers an error in the language named by the X-Locale header', async () => {
    const english = await api('POST', '/api/auth/login', { body: wrongPassword });
    const french = await api('POST', '/api/auth/login', { locale: 'fr', body: wrongPassword });
    assert.equal(french.status, 401);
    assert.ok(french.data.error.length > 0);
    assert.notEqual(french.data.error, english.data.error);
    assert.equal(french.data.error, translate('fr', 'err.badCredentials'));
  });

  it('falls back to English for a language the app does not support', async () => {
    const english = await api('POST', '/api/auth/login', { body: wrongPassword });
    const unknown = await api('POST', '/api/auth/login', { locale: 'xx', body: wrongPassword });
    assert.equal(unknown.data.error, english.data.error);
  });
});
