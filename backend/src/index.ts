import { createApp } from "./app";
import { createDataSource, loadConfig } from "./config";
import { prepareDatabase } from "./database";
import { initializeBackendExtensions, loadBackendExtensions, startBackendExtensions, stopBackendExtensions } from "./extensions";
import { createServices } from "./services";

const config = loadConfig();

const bootstrap = async () => {
  const extensions = await loadBackendExtensions(config);
  if (extensions.length > 0) {
    console.log(`[backend] loaded extensions: ${extensions.map((extension) => extension.manifest.id).join(", ")}`);
  }
  const dataSource = createDataSource(config, extensions);
  await dataSource.initialize();
  const databaseMode = await prepareDatabase(config, dataSource);
  console.log(`[backend] database mode: ${databaseMode}`);
  const services = await createServices(config, dataSource);
  const initializedExtensions = await initializeBackendExtensions(config, services, extensions);
  const app = createApp(config, services, initializedExtensions);
  await startBackendExtensions(initializedExtensions);

  app.listen({ port: config.port, maxRequestBodySize: 100 * 1024 * 1024 }, ({ hostname, port }) => {
    const host = hostname || "0.0.0.0";
    console.log(`[backend] listening on http://${host}:${port}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[backend] received ${signal}; shutting down`);

    try {
      await stopBackendExtensions(initializedExtensions);
      await app.stop();
      await dataSource.destroy();
      console.log("[backend] shutdown complete");
      process.exit(0);
    } catch (error) {
      console.error("[backend] failed during shutdown", error);
      process.exit(1);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
};

bootstrap().catch((error) => {
  console.error("[backend] failed to start", error);
  process.exit(1);
});
