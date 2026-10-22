import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema/index.ts',
  // The initial snapshot was compared with the reviewed SQL baseline. Generate
  // incremental changes from that history; Wrangler executes migrations.
  out: './drizzle',
});
