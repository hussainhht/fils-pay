import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "C:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/apps/web",
  plugins: [react()],
  server: { port: 5175, strictPort: true, proxy: { "/v1": "http://127.0.0.1:3100" } },
});
