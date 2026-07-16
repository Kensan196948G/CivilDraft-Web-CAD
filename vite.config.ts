import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/konva') || id.includes('node_modules/react-konva')) {
            return 'vendor-konva'
          }
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/pdf-lib')) {
            return 'vendor-pdf-lib'
          }
          if (id.includes('node_modules/@pdf-lib/fontkit')) {
            return 'vendor-fontkit'
          }
          if (id.includes('/src/domain/dxf/')) {
            return 'domain-dxf'
          }
          if (id.includes('/src/domain/pdf/')) {
            return 'domain-pdf'
          }
          if (id.includes('/src/domain/')) {
            return 'domain-core'
          }
          if (id.includes('/src/app/pages/')) {
            return 'app-pages'
          }
        },
      },
    },
  },
})
