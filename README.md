# Marche Bou Makk

A multi-vendor marketplace with delivery, built for the Senegal market (Dakar, prices in FCFA). One codebase with four portals sharing one database and one real-time notification system:

- **Shopper (buyer):** browse one catalog, compare offers from every store, add items from several stores to one cart, check out (one order per store), follow live tracking, cancel before the store accepts, and watch products for price and stock alerts.
- **Store (vendor):** store profile, products and stock, incoming orders (accept, decline, mark ready), payouts after commission.
- **Conductor (delivery partner):** go online, share live location, see jobs sorted by distance, accept one job at a time, confirm pickup and drop-off, track earnings. Vehicles: moto, bicycle, car, or van.
- **Admin:** dashboard (merchandise value, commission, open jobs, active deliveries, 7-day chart), approve or suspend stores and conductors, dispatch (automatic or manual), product alerts, and pricing settings.

## Quick start

Requirements: **Node.js 22 or newer**. The database uses Node's built-in SQLite, so there is nothing else to install.

```bash
npm install
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000

On first start the app creates a demo marketplace in Dakar: 3 stores (2 active, 1 awaiting approval), 2 shoppers, 3 conductors (1 awaiting approval), 12 products sold by 2 stores, and a few live orders. Demo password: `demo1234`.

| Role | Email | Who |
|---|---|---|
| Admin | `admin@market.local` | Password `admin1234` |
| Shopper | `buyer@market.local` | Awa Diallo, has a delivered order, an order waiting for the store, and watches Pain complet |
| Shopper | `buyer2@market.local` | Moussa Diop, has a cash order on the way and a bakery order being prepared |
| Store | `vendor1@market.local` | Boulangerie Teranga (Médina) |
| Store | `vendor2@market.local` | Épicerie Keur Fatou (Liberté 6), sells bread too, so you can compare prices |
| Store (pending) | `vendor3@market.local` | Keur Yaye Cuisine. Approve it under Admin → People |
| Conductor | `conductor@market.local` | Ousmane Ba (moto), busy on a delivery |
| Conductor | `conductor2@market.local` | Aminata Sarr (bicycle), free and online |
| Conductor (pending) | `conductor3@market.local` | Cheikh Gueye (car). Approve it under Admin → People |

Reset the demo data at any time with `npm run db:reset`.

## Senegal setup

- **Currency:** FCFA (XOF), shown in whole francs, for example `150 FCFA`.
- **Map center:** Dakar (Plateau). Change it with `MARKET_CENTER_LAT` / `MARKET_CENTER_LNG`.
- **Payments:** shoppers choose **mobile money** (Wave, Orange Money, Free Money) or **cash on delivery**. Mobile money is simulated in this version (approved instantly); see the notes below.
- **Phone numbers:** use the international format, for example `+221 77 000 00 00`.
- **Default pricing** (adjustable in Admin → Settings): platform commission 15%, base delivery fee 500 FCFA, 150 FCFA per km, dispatch radius 8 km, low-stock warning at 3 units.

## Production

```bash
npm run build
NODE_ENV=production JWT_SECRET=<long-random-string> ADMIN_PASSWORD=<strong-password> npm start
```

One process serves the web app and the API on `PORT` (default 4000). Demo data is off by default in production.

### Keeping it online (Windows + Cloudflare Tunnel)

The live site runs on this machine: the Node server on port 4000, exposed by a Cloudflare Tunnel. A watchdog keeps both processes alive:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-watchdog.ps1
```

- Preferred: registers Windows scheduled tasks (at logon, plus a 5-minute keepalive).
- If Task Scheduler is blocked, it copies `scripts\start-watchdog.vbs` into the user's Startup folder and starts the watchdog through WMI, so it survives the terminal that launched it.
- The watchdog checks `http://localhost:4000/api/settings` every 20 seconds and restarts the API when it stops, restarts the tunnel when its process exits, and checks `https://marcheboumakk.com` every 2 minutes.
- Logs: `logs\watchdog.log`, `logs\api.err.log`, `logs\tunnel.err.log`.
- The JWT secret is generated once into `data\jwt-secret.txt` (gitignored), so it is stable across restarts and never committed.

For a fully unattended server, run both as Windows services from an elevated shell (`cloudflared service install` and a service wrapper such as NSSM), and back up `data\market.db` regularly.

## Configuration

Copy `.env.example` to `.env` (or set the variables in your host):

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | dev value | Signs login tokens. **Change it.** |
| `CURRENCY` | `XOF` | Currency code. `XOF` is the FCFA |
| `MARKET_CENTER_LAT` / `MARKET_CENTER_LNG` | Dakar | Where demo stores and conductors are placed |
| `SEED_DEMO` | on outside production | Create demo data on an empty database |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@market.local` / `admin1234` | First admin account |
| `DATA_DIR` | `./data` | Holds `market.db` and uploaded photos |

## Notifications: who gets what

Every notification is stored, pushed live to open browsers (server-sent events), and shows as a toast and a badge. Desktop alerts are optional.

**Order lifecycle** (✓ marks who is notified)

| Event | Shopper | Store | Conductor |
|---|:-:|:-:|:-:|
| Order placed | ✓ confirmation | ✓ new order | |
| Store accepts | ✓ | | ✓ new job nearby (every free, online conductor within the radius) |
| Store declines | ✓ with refund note | | |
| Ready for pickup | ✓ | | ✓ assigned conductor, or free conductors nearby if none is assigned |
| Conductor assigned | ✓ | ✓ | ✓ |
| Picked up | ✓ | ✓ | ✓ with the drop-off address |
| Delivered | ✓ | ✓ payout | ✓ earning |
| Cancelled by shopper | ✓ | ✓ | |

**Product-level alerts** (for any specific product)

| Event | Stores | Shoppers | Conductors |
|---|:-:|:-:|:-:|
| Admin product alert (Admin → Product alerts) | ✓ every store selling the product | ✓ watching it or with an order in progress | ✓ delivering it right now |
| Store changes a price | | ✓ watching shoppers | |
| Store sells out | ✓ that store | ✓ watching shoppers, only if no other store has stock | |
| Back in stock | | ✓ watching shoppers | |
| Low stock | ✓ that store | | |
| A new store lists a product someone watches | | ✓ watching shoppers | |

The admin can also send a general announcement (no product) to any combination of stores, shoppers, and conductors.

## How an order flows

```
placed ──(store accepts)──> preparing ──(store marks ready)──> ready
   │                              │                              │
   │ (store declines /            │ (conductor accepts the job   │ (conductor confirms pickup)
   │  shopper cancels)            │  while it is being prepared) ▼
   ▼                              ▼                     out_for_delivery
rejected / cancelled            (open job on the board)        │
                                                   (conductor confirms drop-off)
                                                               ▼
                                                           delivered
```

- Items are reserved at checkout and returned to stock when an order is declined or cancelled.
- Mobile money orders are marked paid (simulated). Cash orders are marked due and collected by the conductor on delivery.
- A conductor holds one active delivery at a time, and a job can only be claimed once (the claim is checked against the database).
- Stores never see the customer's address or phone. Shoppers see the conductor's location once assigned.

## Project layout

```
src/
  shared/              types and rules used by both sides (money and FCFA formatting, distance, order statuses)
  server/
    accounts.ts        sign-up, login, profiles, store profile, approvals
    catalog.ts         products, store offers, watch list, stock alerts
    orders.ts          quotes, checkout (one order per store), lifecycle, dispatch
    conductors.ts      online status, live location, job board
    audience.ts        who gets a product notification
    notifications.ts   stored notifications and live delivery (SSE)
    alerts.ts          admin product and general alerts
    stats.ts           dashboard numbers
    routes/            HTTP endpoints, one file per portal
    seed.ts            Dakar demo data, created through the real services
  client/
    pages/             shopper, store, conductor and admin screens
    components/        layout, location picker, order progress
tests/api.test.ts      end-to-end API tests
```

## Tests

```bash
npm test
```

The suite starts the real server on a temporary database and covers: store approval, the multi-store cart, cancellations and restocking, the full pickup and drop-off flow with notifications to all three parties, conductor locking, product alerts, auto-dispatch, the live event stream, and role access rules.

## Notes before going live

- **Mobile money is simulated.** Orders are approved instantly and nothing is charged or paid out. Connect Wave, Orange Money, or Free Money inside `checkout()` in `src/server/orders.ts`, and set up the store and conductor payouts with your provider.
- **Language.** The interface is in English. Shoppers in Senegal usually prefer French, so translating the interface (and adding Wolof for product descriptions if needed) is a recommended next step. The demo product names are already in French.
- **Maps and distance.** Locations are coordinates with "Open in Maps" links. Distances are straight-line estimates. Use a routing API for real road distances, which matter a lot in Dakar traffic.
- **Other channels.** Notifications are in-app, live, and optional desktop alerts. SMS (common in Senegal), WhatsApp, email, or mobile push can be added by subscribing to `notify()` in `src/server/notifications.ts`.
- **Single server instance.** Live updates are held in memory, so run one API process. To scale out, move the stream hub to Redis pub/sub and the database from SQLite to Postgres.
- **SQLite.** `node:sqlite` is still marked experimental in Node 22, so it prints a warning on start. It is fine for a single-server deployment.
- **Security.** Passwords are hashed with scrypt and tokens expire after seven days. Before public launch, add HTTPS, rate limiting on login, and backups for `data/`.
- **Terminology.** "Conductor" is the delivery partner (driver or courier), as used in your brief.
