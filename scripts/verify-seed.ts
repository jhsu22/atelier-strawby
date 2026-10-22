import { options, openTarget } from './lib/cli.ts';
import { verifySeed } from './lib/verify.ts';
const opts = options('d1-local');
const db = await openTarget(opts);
try { console.log(JSON.stringify(await verifySeed(db), null, 2)); console.log('Persisted seed verification passed.'); }
finally { await db.close(); }
