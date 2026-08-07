import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/current_patterns': 'http://localhost:8787',
      '/add_new_pattern': 'http://localhost:8787',
      '/remove_new_pattern': 'http://localhost:8787',
      '/update_pattern': 'http://localhost:8787',
      '/reorder_patterns': 'http://localhost:8787',
      '/pattern': 'http://localhost:8787'
    }
  }
});
