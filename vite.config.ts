import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Three.js solo pesa unos 556 kB sin comprimir: ese archivo ya no se puede partir más y el aviso de 500 kB no aporta nada.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Three.js va en su propio archivo: cambia poco y el navegador lo guarda aparte del código de la aplicación, que sí cambia con cada versión.
        manualChunks: (id) => (id.includes('node_modules/three/') ? 'three' : undefined),
      },
    },
  },
});
