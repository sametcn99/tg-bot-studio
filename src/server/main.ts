import 'reflect-metadata';
import helmet from 'helmet';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

/**
 * Bootstraps the unified fullstack NestJS server:
 * `/api/*` REST API, `/tma/*` live Mini Apps, `/*` React 19 dashboard.
 *
 * @returns {Promise<void>} Resolves once the HTTP listener is bound.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Security headers; CSP disabled so the dashboard can embed Mini App
  // previews and remote media without provider allowlists.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors();

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  // Ensures SIGTERM/SIGINT propagate so grammY bots stop cleanly.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 3000;
  // No explicit host: binds all interfaces with dual-stack (IPv4 + IPv6),
  // keeping container healthchecks against localhost functional.
  await app.listen(port);
  new Logger('Bootstrap').log(`Telegram Bot Studio listening on port ${port}`);
}

void bootstrap();
