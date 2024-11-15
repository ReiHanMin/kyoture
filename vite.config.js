// vite.config.js
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [
    laravel({
      input: ['resources/js/app.js'], // Ensure this includes all your entry points
      refresh: true,
    }),
    vue(),
  ],
  // Removed the build section to prevent conflicts with laravel-vite-plugin
});
