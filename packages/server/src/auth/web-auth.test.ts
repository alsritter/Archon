import { describe, expect, test } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';

import {
  AUTH_COOKIE_NAME,
  createApiAuthMiddleware,
  createPageAuthMiddleware,
  isSafeRedirect,
  parseCookies,
  registerWebAuthRoutes,
  resolveWebAuthConfig,
  signCookie,
  verifyCookie,
  type WebAuthConfig,
} from './web-auth';

async function makeEnabledConfig(): Promise<WebAuthConfig> {
  return {
    enabled: true,
    username: 'boss',
    passwordHash: await Bun.password.hash('secret123', {
      algorithm: 'bcrypt',
      cost: 4,
    }),
    cookieSecret: 'test-secret',
    cookieMaxAge: 3600,
  };
}

describe('web auth helpers', () => {
  test('resolves disabled config when no env vars are present', () => {
    const config = resolveWebAuthConfig({});
    expect(config.enabled).toBe(false);
  });

  test('round-trips signed auth cookies', () => {
    const signed = signCookie('authenticated', 'secret');
    expect(verifyCookie(signed, 'secret')).toBe('authenticated');
    expect(verifyCookie(signed, 'other-secret')).toBeNull();
  });

  test('parses cookies and validates redirects safely', () => {
    expect(parseCookies('a=1; b=two')).toEqual({ a: '1', b: 'two' });
    expect(isSafeRedirect('/dashboard')).toBe(true);
    expect(isSafeRedirect('https://example.com')).toBe(false);
  });
});

describe('web auth routes and middleware', () => {
  test('redirects unauthenticated page requests to login with rd param', async () => {
    const config = await makeEnabledConfig();
    const app = new OpenAPIHono();
    registerWebAuthRoutes(app, config);
    app.use('*', createPageAuthMiddleware(config));
    app.get('/dashboard', c => c.text('ok'));

    const response = await app.request('/dashboard?tab=runs');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login?rd=%2Fdashboard%3Ftab%3Druns');
  });

  test('returns 401 for unauthenticated api requests', async () => {
    const config = await makeEnabledConfig();
    const app = new OpenAPIHono();
    app.use('/api/*', createApiAuthMiddleware(config));
    app.get('/api/health', c => c.json({ status: 'ok' }));

    const response = await app.request('/api/health');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  test('allows authenticated login flow and protected routes', async () => {
    const config = await makeEnabledConfig();
    const app = new OpenAPIHono();
    registerWebAuthRoutes(app, config);
    app.use('/api/*', createApiAuthMiddleware(config));
    app.post('/webhooks/feishu', c => c.text('webhook ok'));
    app.use('/assets/*', createPageAuthMiddleware(config));
    app.use('*', createPageAuthMiddleware(config));
    app.get('/api/health', c => c.json({ status: 'ok' }));
    app.get('/dashboard', c => c.text('ok'));

    const loginResponse = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'username=boss&password=secret123&rd=%2Fdashboard',
    });

    expect(loginResponse.status).toBe(302);
    expect(loginResponse.headers.get('location')).toBe('/dashboard');
    const setCookie = loginResponse.headers.get('set-cookie');
    expect(setCookie).toContain(`${AUTH_COOKIE_NAME}=`);

    const dashboardResponse = await app.request('/dashboard', {
      headers: { cookie: setCookie ?? '' },
    });
    expect(dashboardResponse.status).toBe(200);

    const apiResponse = await app.request('/api/health', {
      headers: { cookie: setCookie ?? '' },
    });
    expect(apiResponse.status).toBe(200);

    const webhookResponse = await app.request('/webhooks/feishu', { method: 'POST' });
    expect(webhookResponse.status).toBe(200);
  });

  test('allows safe localhost absolute redirects for dev login flow', async () => {
    const config = await makeEnabledConfig();
    const app = new OpenAPIHono();
    registerWebAuthRoutes(app, config);

    const loginResponse = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=boss&password=secret123&rd=${encodeURIComponent('http://localhost:5173/dashboard')}`,
    });

    expect(loginResponse.status).toBe(302);
    expect(loginResponse.headers.get('location')).toBe('http://localhost:5173/dashboard');
  });
});
