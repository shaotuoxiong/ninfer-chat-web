import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({root:'/web/pages-src',base:'./',plugins:[react()],build:{outDir:'/site/build',emptyOutDir:true,target:'es2022'}})
