import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema/index.ts';
export const createDb = (binding: D1Database) => drizzle(binding, { schema });
