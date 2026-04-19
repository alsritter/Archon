/**
 * Port allocation utilities for Hono server
 * Separated from index.ts to allow testing without triggering app startup
 */
import { createHash } from 'crypto';
import { createServer } from 'net';
import { isWorktreePath } from '@archon/git';
import { createLogger } from '@archon/paths';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('port-allocation');
  return cachedLog;
}

/**
 * Calculate hash-based port offset for worktree paths.
 * Exported for testing.
 *
 * @param path - The worktree path to hash
 * @returns Offset in range 100-999 (ports 3190-4089 when added to base 3090)
 */
export function calculatePortOffset(path: string): number {
  const hash = createHash('md5').update(path).digest();
  // 100-999 range: offset starts at 100; produces ports 3190-4089 when added to basePort (3090)
  return (hash.readUInt16BE(0) % 900) + 100;
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise(resolve => {
    const server = createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, '0.0.0.0');
  });
}

export async function findAvailablePort(
  preferredPort: number,
  maxAttempts = 50,
  checkPortAvailability: (port: number) => Promise<boolean> = isPortAvailable
): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidatePort = preferredPort + offset;
    if (await checkPortAvailability(candidatePort)) {
      return candidatePort;
    }
  }

  throw new Error(
    `No available port found starting at ${preferredPort} after ${maxAttempts} attempts`
  );
}

/**
 * Get the port for the Hono server
 * - If PORT env var is set: use it (explicit override, validated)
 * - If running in worktree: auto-allocate deterministic port based on path hash
 * - Otherwise: use default 3000
 *
 * Note: Exits process with code 1 if PORT env var is set but invalid (not 1-65535)
 */
export async function getPort(): Promise<number> {
  const envPort = process.env.PORT;

  if (envPort) {
    const parsedPort = Number(envPort);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      getLog().fatal({ envPort }, 'invalid_port_env_var');
      process.exit(1);
    }
    return parsedPort;
  }

  const basePort = 3090;
  const cwd = process.cwd();

  if (await isWorktreePath(cwd)) {
    const preferredPort = basePort + calculatePortOffset(cwd);
    const port = await findAvailablePort(preferredPort);
    getLog().info({ cwd, port, preferredPort, basePort }, 'worktree_port_allocated');
    return port;
  }

  const port = await findAvailablePort(basePort);
  getLog().info({ port, preferredPort: basePort }, 'default_port_selected');
  return port;
}
