import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig, loadEnv} from 'vite';

// Plugin to replace %APP_NAME% placeholder in index.html
function appNamePlugin() {
  const appName = process.env.APP_NAME || 'Chat';
  return {
    name: 'app-name-replacer',
    transformIndexHtml(html: string) {
      return html.replace(/%APP_NAME%/g, appName);
    }
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), appNamePlugin()],
    define: {
      'import.meta.env.VITE_APP_NAME': JSON.stringify(env.APP_NAME || 'Chat'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
