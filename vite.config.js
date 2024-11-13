// vite.config.js
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [
    laravel({
      input: ['resources/js/app.js'], // Update this as needed
      refresh: true,
    }),
    vue(),
  ],
  build: {
    manifest: true, // Ensure the manifest is created
    outDir: 'public/build', // Set the output directory to `public/build`
    emptyOutDir: true, // Clear the output directory before building
  },
  // Specify the root to avoid placing the `manifest.json` inside `.vite`
  root: '.',
});
