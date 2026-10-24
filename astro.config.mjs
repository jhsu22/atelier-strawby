import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// Astro streams pages as a Node async iterable when `process` looks like Node's.
// Hosted Pages with nodejs_compat passes that check, and the Workers Response
// stringifies the iterable, so every page body became "[object Object]".
// Workers always want a web ReadableStream.
const NODE_CHECK = 'const isNode = typeof process !== "undefined" && Object.prototype.toString.call(process) === "[object process]";';
function forceWebStreams() {
  return {
    name: 'strawby:force-web-streams',
    apply: 'build',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/astro/dist/runtime/server/render/util.js')) return;
      if (!code.includes(NODE_CHECK)) throw new Error('Astro changed its Node detection; review strawby:force-web-streams.');
      return code.replace(NODE_CHECK, 'const isNode = false;');
    },
  };
}

export default defineConfig({
  output: 'server',
  devToolbar: { enabled: false },
  adapter: cloudflare({ imageService: 'passthrough', platformProxy: { enabled: true } }),
  integrations: [react()],
  vite: { plugins: [tailwindcss(), forceWebStreams()] },
});
