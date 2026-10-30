import { createApp } from './app';
import { config } from './config';
import { initDatabase } from './seed';

initDatabase();

if (config.isProduction && config.jwtSecret === 'dev-only-secret-change-me') {
  console.warn('Set JWT_SECRET before deploying to production.');
}

createApp().listen(config.port, () => {
  console.log(`Marche Bou Makk API running on http://localhost:${config.port}`);
  if (!config.isProduction) console.log('Web app in development: http://localhost:5173');
});
