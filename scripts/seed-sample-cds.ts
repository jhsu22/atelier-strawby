import { options, openTarget } from './lib/cli.ts';
import { seedSampleCds } from './lib/sample-cds.ts';
const db = await openTarget(options('d1-local'));
try { console.log(`${await seedSampleCds(db)} demonstration CDs present; excluded from personal statistics.`); }
finally { await db.close(); }
