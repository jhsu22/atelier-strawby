/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

type Runtime = import('@astrojs/cloudflare').Runtime<{
  DB: D1Database;
  COVERS: R2Bucket;
  APP_ENV: string;
  LOCAL_DEV_AUTH?: string;
}>;
declare namespace App {
  interface Locals extends Runtime {}
}
