import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export * from "./schema";
export * from "./stores";

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb(connectionString: string): ReturnType<typeof drizzle<typeof schema>> {
  if (cached) {
    return cached;
  }
  const client = postgres(connectionString, { max: 20, connect_timeout: 5 });
  cached = drizzle(client, { schema });
  return cached;
}

export function resetDbCache(): void {
  cached = null;
}
