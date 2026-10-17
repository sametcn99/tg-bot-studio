import 'reflect-metadata';
import helmet from 'helmet';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { MetricsInterceptor } from './common/interceptors/metrics.interceptor';
import { isDefaultJwtSecretEnv, isDefaultMasterKeyEnv } from './auth/auth-defaults';

/**
 * Refuses to boot with the documented default credentials in production —
 * a deployment that ships `admin123` or the fallback JWT secret is one port
 * scan away from full takeover. Operators must set real values explicitly.
 * @returns {void} Throws when running in production with default credentials.
 */
function assertProductionCredentials(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const defaults: string[] = [];
  if (isDefaultMasterKeyEnv()) defaults.push('ADMIN_MASTER_KEY');
  if (isDefaultJwtSecretEnv()) defaults.push('JWT_SECRET');
  if (defaults.length > 0) {
    throw new Error(
      `Refusing to start in production with default credentials: ${defaults.join(', ')}. ` +
        'Set real values in the environment before deploying publicly.',
    );
  }
}

/**
 * Bootstraps the unified fullstack NestJS server:
 * `/api/*` REST API, `/tma/*` live Mini Apps, `/*` React 19 dashboard.
 *
 * @returns {Promise<void>} Resolves once the HTTP listener is bound.
 */
async function bootstrap(): Promise<void> {
  assertProductionCredentials();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Raw body is required to verify webhook HMAC signatures over the exact
    // bytes the sender signed (JSON re-serialization is not byte-stable).
    rawBody: true,
  });

  const expressApp = app.getHttpAdapter().getInstance();
  // Trust reverse-proxy hop (default 1 for Coolify / Traefik / Nginx; set TRUST_PROXY=2 if behind Cloudflare).
  const trustProxyEnv = process.env.TRUST_PROXY;
  const trustProxy = trustProxyEnv
    ? Number.isNaN(Number(trustProxyEnv))
      ? trustProxyEnv
      : Number(trustProxyEnv)
    : 1;
  expressApp.set('trust proxy', trustProxy);

  // Security headers. CSP allows: the app's own assets, inline styles (MUI
  // emotion injection), Telegram's WebApp SDK for Mini App pages, Cloudflare Web
  // Analytics beacons, and https media/frames for operator remote content.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", 'https://telegram.org', 'https://static.cloudflareinsights.com'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:', 'https:'],
          'media-src': ["'self'", 'blob:', 'https:'],
          'connect-src': ["'self'", 'https:', 'https://cloudflareinsights.com'],
          'font-src': ["'self'", 'data:'],
          'frame-src': ["'self'", 'https:'],
          'frame-ancestors': ["'self'", 'https://web.telegram.org', 'https://telegram.org'],
          // Self-hosted deployments commonly run plain HTTP on a LAN; the
          // upgrade directive would break subresource loading there.
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );

  // CORS configuration:
  // Allows dashboard assets (<script type="module" crossorigin>), TMA webviews,
  // and same-origin / proxy requests to load without restriction.
  // Set CORS_ORIGINS="https://a.example.com,https://b.example.com" or "*" for external clients.
  const rawCorsOrigins = (process.env.CORS_ORIGINS ?? '').trim();
  if (rawCorsOrigins === '*' || !rawCorsOrigins) {
    app.enableCors({
      origin: true,
      credentials: true,
    });
  } else {
    const allowed = new Set(
      rawCorsOrigins
        .split(',')
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    );
    app.enableCors({
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        // Allow requests with no origin (curl, same-origin direct, mobile) or in allowed list
        if (!origin || allowed.has(origin)) {
          callback(null, true);
        } else {
          // Gracefully omit CORS headers without throwing an uncaught 500 error
          callback(null, false);
        }
      },
      credentials: true,
    });
  }

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor(), new MetricsInterceptor());

  // Live API reference at /api/docs (route discovery only; every endpoint
  // keeps its normal JWT guard).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Telegram Bot Studio API')
    .setDescription('Self-hosted Telegram bot & Mini App management studio API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  // Ensures SIGTERM/SIGINT propagate so grammY bots stop cleanly.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 3000;
  // No explicit host: binds all interfaces with dual-stack (IPv4 + IPv6),
  // keeping container healthchecks against localhost functional.
  await app.listen(port);
  new Logger('Bootstrap').log(`Telegram Bot Studio listening on port ${port}`);
}

// A single unhandled rejection must never silently drop writes (or, on Node,
// kill the process). Log with full stack; `uncaughtException` exits so the
// supervisor (Docker restart policy) gives the studio a clean process.
process.on('unhandledRejection', (reason) => {
  const logger = new Logger('Process');
  logger.error(`Unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
});
process.on('uncaughtException', (error) => {
  new Logger('Process').error(`Uncaught exception: ${error.stack ?? error.message}`);
  process.exit(1);
});

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    `Fatal bootstrap error: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exit(1);
});
