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
      '/pattern': 'http://localhost:8787',
      '/stored_patterns': 'http://localhost:8787',
      '/store_patterns': 'http://localhost:8787',
      '/add_stored_patterns': 'http://localhost:8787',
      '/remove_stored_pattern': 'http://localhost:8787',
      '/set_pattern_paused': 'http://localhost:8787',
      '/server_paused': 'http://localhost:8787',
      '/set_server_paused': 'http://localhost:8787',
    }
  }
});
