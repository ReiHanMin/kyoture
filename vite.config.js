import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import laravel from 'laravel-vite-plugin';

export default defineConfig(({ command, mode }) => {
    return {
        plugins: [
            laravel({
                input:  'resources/js/app.js',
                refresh: true,
            }),
            vue(),
        ],
        build: {
            manifest: true,
            outDir: 'public/build',
          },
        resolve: {
            alias: {
                'vue': 'vue/dist/vue.esm-bundler.js',
            },
        },
        base: mode === 'production' ? 'https://kyoture-production.up.railway.app/' : '/',
        server: {
            https: true, // Use HTTPS for local development (optional)
        },
        build: {
            manifest: true,
            rollupOptions: {
                output: {
                    entryFileNames: 'assets/[name]-[hash].js',
                    chunkFileNames: 'assets/[name]-[hash].js',
                    assetFileNames: 'assets/[name]-[hash][extname]',
                },
            },
        },
    };
});
