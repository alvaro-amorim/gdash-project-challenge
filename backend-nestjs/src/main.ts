import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

function parseCorsOrigins(rawValue?: string) {
  return (rawValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3000;
  const publicApiUrl = process.env.API_PUBLIC_URL?.trim();
  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);
  const shouldTrustProxy = process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production';
  const httpAdapter = app.getHttpAdapter().getInstance();

  if (shouldTrustProxy && typeof httpAdapter?.set === 'function') {
    httpAdapter.set('trust proxy', 1);
  }

  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
    });
    logger.log(`CORS enabled for: ${corsOrigins.join(', ')}`);
  } else {
    app.enableCors();
    logger.warn('CORS enabled for all origins. Set CORS_ORIGIN to restrict public access.');
  }

  // API Documentation Configuration (Swagger/OpenAPI)
  const config = new DocumentBuilder()
    .setTitle('GDASH API')
    .setDescription('Weather Monitoring System API')
    .setVersion('1.0')
    .addTag('Weather', 'Meteorological data ingestion and retrieval')
    .addTag('Users', 'Authentication and access control')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(port);

  logger.log(`Application is running on: ${publicApiUrl || `http://localhost:${port}`}`);
  logger.log(`Swagger documentation: ${publicApiUrl ? `${publicApiUrl}/api` : `http://localhost:${port}/api`}`);
}
bootstrap();
