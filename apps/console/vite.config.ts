import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** QED_CONSOLE_BASE sets the path the console is served from. */
export default defineConfig({
  base: process.env["QED_CONSOLE_BASE"] ?? "/",
  plugins: [react()],
  build: { assetsInlineLimit: 0 },
});
