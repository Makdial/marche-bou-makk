import fs from 'node:fs';
import { config } from '../config';

for (const file of [config.dbFile, `${config.dbFile}-journal`, `${config.dbFile}-wal`, `${config.dbFile}-shm`]) {
  fs.rmSync(file, { force: true });
}

const { initDatabase } = await import('../seed');
initDatabase();
console.log('Database reset. Demo data is ready.');
