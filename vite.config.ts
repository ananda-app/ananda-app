import { sveltekit } from '@sveltejs/kit/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default {
  plugins: [
    sveltekit(),
    nodePolyfills({
      include: ['assert', 'events', 'url', 'os', 'path', 'fs']
    })
  ]
};