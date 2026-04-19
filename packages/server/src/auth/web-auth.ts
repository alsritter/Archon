import { createHmac, timingSafeEqual } from 'crypto';
import type { Context, MiddlewareHandler } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';

export const AUTH_COOKIE_NAME = 'archon_auth';
const DEFAULT_COOKIE_MAX_AGE = 60 * 60 * 24;
const AUTH_COOKIE_VALUE = 'authenticated';
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export interface WebAuthConfig {
  enabled: boolean;
  username: string;
  passwordHash: string;
  cookieSecret: string;
  cookieMaxAge: number;
}

export function resolveWebAuthConfig(env: NodeJS.ProcessEnv = process.env): WebAuthConfig {
  const username = env.AUTH_USERNAME?.trim() ?? '';
  const passwordHash = env.AUTH_PASSWORD_HASH?.trim() ?? '';
  const cookieSecret = env.COOKIE_SECRET?.trim() ?? '';
  const cookieMaxAge = Number.parseInt(env.COOKIE_MAX_AGE ?? String(DEFAULT_COOKIE_MAX_AGE), 10);

  const hasAnyAuthConfig = Boolean(username || passwordHash || cookieSecret);
  if (!hasAnyAuthConfig) {
    return {
      enabled: false,
      username: '',
      passwordHash: '',
      cookieSecret: '',
      cookieMaxAge: DEFAULT_COOKIE_MAX_AGE,
    };
  }

  if (!username || !passwordHash || !cookieSecret) {
    console.warn(
      '[server] Web auth disabled: AUTH_USERNAME, AUTH_PASSWORD_HASH, and COOKIE_SECRET must all be set.'
    );
    return {
      enabled: false,
      username,
      passwordHash,
      cookieSecret,
      cookieMaxAge: Number.isFinite(cookieMaxAge) ? cookieMaxAge : DEFAULT_COOKIE_MAX_AGE,
    };
  }

  if (!BCRYPT_HASH_PATTERN.test(passwordHash)) {
    console.warn('[server] Web auth disabled: AUTH_PASSWORD_HASH is not a valid bcrypt hash.');
    return {
      enabled: false,
      username,
      passwordHash,
      cookieSecret,
      cookieMaxAge: Number.isFinite(cookieMaxAge) ? cookieMaxAge : DEFAULT_COOKIE_MAX_AGE,
    };
  }

  return {
    enabled: true,
    username,
    passwordHash,
    cookieSecret,
    cookieMaxAge: Number.isFinite(cookieMaxAge) ? cookieMaxAge : DEFAULT_COOKIE_MAX_AGE,
  };
}

export function signCookie(value: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${signature}`;
}

export function verifyCookie(signed: string, secret: string): string | null {
  const separator = signed.lastIndexOf('.');
  if (separator === -1) return null;
  const value = signed.slice(0, separator);
  const expected = createHmac('sha256', secret).update(value).digest('base64url');
  const actualBuffer = Buffer.from(signed.slice(separator + 1), 'base64url');
  const expectedBuffer = Buffer.from(expected, 'base64url');
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  return value;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(cookie => {
      const separator = cookie.indexOf('=');
      return separator === -1
        ? [cookie.trim(), '']
        : [cookie.slice(0, separator).trim(), cookie.slice(separator + 1).trim()];
    })
  );
}

export function isSafeRedirect(target: string): boolean {
  return target === '/' || (/^\/[^/\\]/.test(target) && !target.includes('://'));
}

function resolveSafeRedirect(target: string, requestUrl: string): string {
  if (isSafeRedirect(target)) {
    return target;
  }

  try {
    const requested = new URL(target);
    const current = new URL(requestUrl);
    const isHttp = requested.protocol === 'http:' || requested.protocol === 'https:';
    const sameHost = requested.hostname === current.hostname;
    return isHttp && sameHost ? requested.toString() : '/';
  } catch {
    return '/';
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getRequestPath(c: Context): string {
  const url = new URL(c.req.url);
  const candidate = `${url.pathname}${url.search}`;
  return isSafeRedirect(candidate) ? candidate : '/';
}

function getFormValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function isAuthenticated(c: Context, config: WebAuthConfig): boolean {
  if (!config.enabled) return true;
  const cookies = parseCookies(c.req.header('cookie'));
  return verifyCookie(cookies[AUTH_COOKIE_NAME] ?? '', config.cookieSecret) === AUTH_COOKIE_VALUE;
}

function authCookieHeader(config: WebAuthConfig, maxAge: number): string {
  return [
    `${AUTH_COOKIE_NAME}=${signCookie(AUTH_COOKIE_VALUE, config.cookieSecret)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${String(maxAge)}`,
  ].join('; ');
}

function clearedAuthCookieHeader(): string {
  return `${AUTH_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function createPageAuthMiddleware(config: WebAuthConfig): MiddlewareHandler {
  return async (c, next) => {
    if (!config.enabled || isAuthenticated(c, config)) {
      await next();
      return;
    }

    return c.redirect(`/login?rd=${encodeURIComponent(getRequestPath(c))}`);
  };
}

export function createApiAuthMiddleware(config: WebAuthConfig): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'OPTIONS') {
      await next();
      return;
    }

    if (!config.enabled || isAuthenticated(c, config)) {
      await next();
      return;
    }

    return c.json({ error: 'Authentication required' }, 401);
  };
}

function loginPage(rd: string, error: string | null): string {
  const errorBlock = error ? `<div class="error">${escapeHtml(error)}</div>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sign In · Archon</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0b0d12; font-family: system-ui, sans-serif; color: #e5e7eb; padding: 1rem; }
    .card { width: 100%; max-width: 360px; padding: 1.75rem; border-radius: 16px; background: #12161f; border: 1px solid #222836; box-shadow: 0 12px 40px rgba(0,0,0,.35); }
    h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1.25rem; text-align: center; }
    label { display: block; font-size: .875rem; color: #9ca3af; margin-bottom: .35rem; }
    input { width: 100%; padding: .7rem .8rem; border-radius: 10px; border: 1px solid #2b3345; background: #0b0d12; color: #f3f4f6; margin-bottom: 1rem; }
    input:focus { outline: 2px solid #2563eb; border-color: #2563eb; }
    button { width: 100%; padding: .8rem; border: none; border-radius: 10px; background: #2563eb; color: white; font-size: 1rem; font-weight: 600; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    .error { background: rgba(127,29,29,.35); border: 1px solid rgba(248,113,113,.35); color: #fca5a5; padding: .8rem; border-radius: 10px; margin-bottom: 1rem; font-size: .875rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Sign In</h1>
    ${errorBlock}
    <form method="POST" action="/login">
      <input type="hidden" name="rd" value="${escapeHtml(rd)}">
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocomplete="username" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`;
}

export function registerWebAuthRoutes(app: OpenAPIHono, config: WebAuthConfig): void {
  app.get('/login', c => {
    if (!config.enabled) {
      return c.redirect('/');
    }

    const requestedRedirect = c.req.query('rd') ?? '/';
    const safeRedirect = resolveSafeRedirect(requestedRedirect, c.req.url);
    if (isAuthenticated(c, config)) {
      return c.redirect(safeRedirect);
    }

    return c.html(loginPage(safeRedirect, null));
  });

  app.post('/login', async c => {
    if (!config.enabled) {
      return c.redirect('/');
    }

    const body = await c.req.parseBody();
    const username = getFormValue(body.username);
    const password = getFormValue(body.password);
    const requestedRedirect = getFormValue(body.rd, '/');
    const safeRedirect = resolveSafeRedirect(requestedRedirect, c.req.url);

    const usernameMatches = username === config.username;
    const passwordMatches = await Bun.password.verify(password, config.passwordHash);

    if (!usernameMatches || !passwordMatches) {
      c.status(401);
      return c.html(loginPage(safeRedirect, 'Invalid username or password.'));
    }

    c.header('Set-Cookie', authCookieHeader(config, config.cookieMaxAge));
    return c.redirect(safeRedirect);
  });

  app.get('/logout', c => {
    c.header('Set-Cookie', clearedAuthCookieHeader());
    return c.redirect(config.enabled ? '/login' : '/');
  });
}
