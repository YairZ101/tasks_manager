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
