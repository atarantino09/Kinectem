import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createRequire } from "node:module";

const appRequire = createRequire(new URL("../kinectem/package.json", import.meta.url));
const sharedUiPackages = [
  "@radix-ui/react-dialog", "@radix-ui/react-slot", "@radix-ui/react-switch",
  "class-variance-authority", "clsx", "tailwind-merge",
];

export default defineConfig({
  base: "/__mockup/",
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: Object.fromEntries(sharedUiPackages.map((name) => [name, appRequire.resolve(name)])),
  },
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 5173,
    allowedHosts: true,
  },
});