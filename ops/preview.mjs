// Local UI preview for the existing Docker backend on localhost:3000.
// Run from the repository root: node ops/preview.mjs
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const definitions = [
  { directory: "web", port: 5173, variable: "VITE_API_BASE_URL", path: "/dashboard/login" },
  { directory: "admin", port: 5174, variable: "VITE_ADMIN_API_BASE_URL", path: "/login" },
];
const servers = [];
try {
  for (const definition of definitions) {
    const root = fileURLToPath(new URL(`../apps/${definition.directory}/`, import.meta.url));
    const server = await createServer({
      root,
      configFile: fileURLToPath(new URL(`../apps/${definition.directory}/vite.config.ts`, import.meta.url)),
      define: { [`import.meta.env.${definition.variable}`]: JSON.stringify("") },
      server: {
        host: "127.0.0.1",
        port: definition.port,
        strictPort: true,
        proxy: { "/v1": "http://127.0.0.1:3000", "/healthz": "http://127.0.0.1:3000" },
      },
    });
    servers.push(server);
    await server.listen();
    console.log(`${definition.directory}: http://localhost:${definition.port}${definition.path}`);
  }
} catch (error) {
  await Promise.all(servers.map(server => server.close()));
  console.error(error);
  process.exitCode = 1;
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await Promise.all(servers.map(server => server.close()));
    process.exit(0);
  });
}
