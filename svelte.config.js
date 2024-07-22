import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Using the Cloudflare adapter for deployment on Cloudflare
    adapter: adapter()
  },
  preprocess: vitePreprocess(),
};

export default config;