import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// Relative base so the build works at any path: GitHub Pages project sites
// (https://<user>.github.io/<repo>/), custom domains, or a sub-folder.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: `${root}index.html`,
        admin: `${root}admin.html`,
      },
    },
  },
});
