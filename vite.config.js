import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from '@tailwindcss/vite'


export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
    ], 
    server: {
        port: 1420,     // deve combaciare con devUrl in tauri.conf.json
        strictPort: true
    }
});