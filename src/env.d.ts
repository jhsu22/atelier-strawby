/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

type Runtime = import("@astrojs/cloudflare").Runtime<{
  DB: D1Database;
  COVERS: R2Bucket;
  APP_ENV: string;
  LOCAL_DEV_AUTH?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUDIENCE?: string;
  ACCESS_OWNER_EMAIL?: string;
  APP_ORIGIN?: string;
  METADATA_CONTACT?: string;
}>;
declare namespace App {
  interface Locals extends Runtime {}
}
