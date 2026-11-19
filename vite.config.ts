import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    // No public source maps: they tripled the deploy size and expose the source
    // bundle on the hosted site.
    sourcemap: false,
    // ExcelJS is a dynamic import that only loads when someone exports XLSX.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
          'vendor-pdf': ['jspdf', 'jspdf-autotable'],
          'vendor-data': ['@tanstack/react-query', '@supabase/supabase-js'],
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  },
})
