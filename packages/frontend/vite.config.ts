import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/status': 'http://127.0.0.1:4200',
      '/events': {
        target: 'http://127.0.0.1:4200',
        changeOrigin: true,
        headers: {
          'X-Accel-Buffering': 'no',
        },
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // Prevent http-proxy from buffering SSE responses
            proxyRes.headers['cache-control'] = 'no-cache';
            proxyRes.headers['x-accel-buffering'] = 'no';
          });
        },
      },
      '/tasks': 'http://127.0.0.1:4200',
      '/agent-config': 'http://127.0.0.1:4200',
      '/init': 'http://127.0.0.1:4200',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
