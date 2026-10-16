import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7: the datasource url lives here instead of schema.prisma.
// Mirrors PrismaService: DB_PATH (or ./data/studio.sqlite) resolved from cwd.
const dbPath = process.env.DB_PATH || './data/studio.sqlite';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: `file:${resolve(process.cwd(), dbPath).replace(/\\/g, '/')}`,
  },
});
