import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves from /nnnBLAST/ — use relative paths for production
  base: process.env.GITHUB_ACTIONS ? '/nnnBLAST/' : '/',
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  optimizeDeps: {
    exclude: ['nnnblast-wasm'],
  },
})
