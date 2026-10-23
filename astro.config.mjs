import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  devToolbar: { enabled: false },
  adapter: cloudflare({ imageService: 'passthrough', platformProxy: { enabled: true } }),
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
