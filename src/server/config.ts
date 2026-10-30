import path from 'node:path';

const isProduction = process.env.NODE_ENV === 'production';
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));

export const config = {
  port: Number(process.env.PORT ?? 4000),
  isProduction,
  dataDir,
  dbFile: path.join(dataDir, 'market.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  clientDir: path.resolve(process.cwd(), 'dist', 'client'),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  currency: process.env.CURRENCY ?? 'XOF',
  // Default map center: Dakar, Senegal (Plateau).
  center: {
    lat: Number(process.env.MARKET_CENTER_LAT ?? 14.6928),
    lng: Number(process.env.MARKET_CENTER_LNG ?? -17.4467),
  },
  seedDemo: process.env.SEED_DEMO ? process.env.SEED_DEMO !== 'false' : !isProduction,
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@market.local',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin1234',
};
