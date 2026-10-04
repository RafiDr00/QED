import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** The component index Playwright shoots. Never shipped. */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: 4313, strictPort: true },
  preview: { port: 4313, strictPort: true },
});
