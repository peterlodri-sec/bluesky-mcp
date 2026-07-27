import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load .env from the project root (one level up from dist/ or src/) so the
// server works no matter what cwd the MCP client launches it from — then also
// honour a .env in the launch cwd, with real environment variables winning.
const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, "..", ".env") });
dotenv.config();

export interface BlueskyConfig {
  identifier: string;
  password: string;
  service: string;
}

export function loadConfig(): BlueskyConfig {
  const identifier = process.env.BLUESKY_IDENTIFIER;
  const password = process.env.BLUESKY_APP_PASSWORD;
  const service = process.env.BLUESKY_SERVICE || "https://bsky.social";

  if (!identifier || !password) {
    throw new Error(
      "Missing required environment variables: BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD"
    );
  }

  return { identifier, password, service };
}
