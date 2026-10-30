const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "postgres"]);
const LOCAL_DATABASE = /^filspay(?:_dev|_test(?:_[a-zA-Z0-9_-]+)?)?$/;

/** Refuse destructive fixture resets unless both intent and destination are explicit. */
export function assertDestructiveSeedAllowed(
  connectionString: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.ALLOW_DESTRUCTIVE_SEED !== "1") {
    throw new Error("seed: destructive reset requires ALLOW_DESTRUCTIVE_SEED=1");
  }
  if (env.NODE_ENV && env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    throw new Error("seed: destructive reset is restricted to development/test environments");
  }
  if (!connectionString) {
    throw new Error("seed: an explicit local/dev database connection string is required");
  }
  let destination: URL;
  try {
    destination = new URL(connectionString);
  } catch {
    throw new Error("seed: invalid database connection string");
  }
  // libpq-style URL parameters can override the authority/path destination.
  const overridesDestination = ["host", "hostaddr", "database", "dbname", "service"]
    .some((key) => destination.searchParams.has(key));
  if (
    !["postgres:", "postgresql:"].includes(destination.protocol) ||
    !LOCAL_HOSTS.has(destination.hostname) ||
    !LOCAL_DATABASE.test(destination.pathname.slice(1)) ||
    overridesDestination
  ) {
    throw new Error("seed: destination is not an allowlisted local/dev database");
  }
}
