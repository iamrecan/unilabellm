import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: 'ui',
  build: { outDir: '../dist' },
  server: {
    port: 5173,
    proxy: {
      '/sessions': 'http://localhost:8000',
      '/sources': 'http://localhost:8000',
      '/workspace': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
    }
  }
})
