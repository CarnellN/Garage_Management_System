import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react' // or '@vitejs/plugin-vue' for Vue

export default defineConfig({
  plugins: [react()],
})
