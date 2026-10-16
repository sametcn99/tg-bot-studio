import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BotModel } from '../bots/bot.model';
import { BotsService } from '../bots/bots.service';
import { PrismaService } from '../database/prisma.service';
import { createFakeBot } from './helpers/fake-bot';

/**
 * Export → import round-trip against a real temporary SQLite database,
 * verifying the P0 fix: Mini Apps survive import, and re-importing the same
 * bundle does not duplicate autoresponder/drip rows (idempotent upserts).
 */
describe('bot export/import round-trip', () => {
  let prisma: PrismaService;
  let bots: BotsService;
  let dbDir: string;
  let sourceBotId: number;

  const stubs = {
    pool: {
      restartBot: async () => undefined,
      stopBot: async () => undefined,
      destroyBot: () => undefined,
      getStatus: () => 'inactive' as const,
      getDailyVolume: () => 0,
      getRuntimeInfo: () => ({ status: 'stopped' as const, retryCount: 0 }),
    },
    chatSettings: { invalidate: () => undefined },
    noop: undefined,
  };

  beforeAll(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'studio-roundtrip-'));
    const dbPath = join(dbDir, 'roundtrip.sqlite');
    // Point the PrismaService at the scratch database before constructing it.
    process.env.DB_PATH = dbPath;
    prisma = new PrismaService();
    await prisma.$connect();
    // Apply the versioned migrations to the scratch database.
    execSync('bunx prisma migrate deploy', {
      cwd: resolve(__dirname, '../../..'),
      env: { ...process.env, DATABASE_URL: `file:${dbPath.replace(/\\/g, '/')}` },
      stdio: 'ignore',
    });

    const botModel = new BotModel(prisma);
    bots = new BotsService(
      botModel,
      prisma,
      stubs.pool as never,
      {} as never,
      {} as never,
      {} as never,
      { log: () => undefined } as never,
      stubs.chatSettings as never,
      { getDiagnostics: async () => ({}) } as never,
    );

    const source = await prisma.bot.create({
      data: {
        name: 'Source Bot',
        token: '111111:source-token-a',
        username: 'source_bot',
        firstName: 'Source',
        isActive: 0,
      },
    });
    sourceBotId = source.id;

    await prisma.botModule.create({
      data: {
        botId: sourceBotId,
        moduleKey: 'welcome',
        isEnabled: 1,
        configJson: JSON.stringify({ template: 'Hi {first_name}!' }),
      },
    });
    await prisma.autoresponder.create({
      data: { botId: sourceBotId, command: '/help', responseText: 'Help text' },
    });
    await prisma.dripCampaign.create({
      data: {
        botId: sourceBotId,
        name: 'Onboarding',
        stepsJson: JSON.stringify([{ delayMinutes: 10, text: 'Step 1' }]),
      },
    });
    await prisma.miniApp.create({
      data: {
        botId: sourceBotId,
        name: 'Shop',
        slug: `shop-${sourceBotId}`,
        templateType: 'ecommerce',
        title: 'Shop',
        configJson: JSON.stringify({ products: [{ id: 'p1', title: 'Mug', price: 5 }] }),
      },
    });
  }, 30_000);

  afterAll(async () => {
    await prisma.$disconnect().catch(() => undefined);
    delete process.env.DB_PATH;
    try {
      rmSync(dbDir, { recursive: true, force: true });
    } catch {
      // Windows may keep the file briefly locked; the temp dir is disposable.
    }
  });

  it('restores mini apps and stays idempotent on re-import', async () => {
    const bundle = await bots.exportConfig(sourceBotId);
    expect(Array.isArray(bundle.miniApps)).toBe(true);
    expect((bundle.miniApps as unknown[]).length).toBe(1);

    const target = await prisma.bot.create({
      data: {
        name: 'Target Bot',
        token: '222222:target-token-b',
        username: 'target_bot',
        firstName: 'Target',
        isActive: 0,
      },
    });

    const first = await bots.importConfig(target.id, bundle);
    expect(first.success).toBe(true);
    expect(first.importedModules).toBe(1);
    expect(first.importedMiniApps).toBe(1);

    // THE P0 assertion: the Mini App must exist after import.
    const importedApp = await prisma.miniApp.findFirst({ where: { botId: target.id } });
    expect(importedApp).not.toBeNull();
    expect(importedApp?.templateType).toBe('ecommerce');

    // Idempotency: importing the same bundle twice must not duplicate rows.
    const second = await bots.importConfig(target.id, bundle);
    expect(second.importedMiniApps).toBe(1);
    expect(await prisma.autoresponder.count({ where: { botId: target.id } })).toBe(1);
    expect(await prisma.dripCampaign.count({ where: { botId: target.id } })).toBe(1);
    expect(await prisma.botModule.count({ where: { botId: target.id } })).toBe(1);
  });

  it('rejects bundles without a known version', async () => {
    const target = await prisma.bot.create({
      data: {
        name: 'Version Bot',
        token: '333333:target-token-c',
        isActive: 0,
      },
    });
    await expect(bots.importConfig(target.id, { modules: [] })).rejects.toThrow(
      /Unsupported export bundle version/,
    );
  });

  it('masks credential-shaped config values on module reads', async () => {
    const bot = await prisma.bot.create({
      data: {
        name: 'Mask Bot',
        token: '444444:target-token-d',
        isActive: 0,
      },
    });
    await prisma.botModule.create({
      data: {
        botId: bot.id,
        moduleKey: 'ai-assistant',
        isEnabled: 1,
        configJson: JSON.stringify({ apiKey: 'sk-super-secret', model: 'gpt-4o-mini' }),
      },
    });
    const modules = await bots.listModules(bot.id);
    const ai = modules.find((m) => m.key === 'ai-assistant') as {
      config: Record<string, unknown>;
    };
    expect(ai.config.apiKey).toBe('__MASKED__');
    expect(ai.config.model).toBe('gpt-4o-mini');
  });

  it('creates a working fake bot for runtime-module tests', async () => {
    const { bot, calls } = createFakeBot();
    await bot.api.sendMessage(123, 'hello', { parse_mode: 'HTML' });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('sendMessage');
    expect(calls[0].payload.text).toBe('hello');
    expect(bot.botInfo.username).toBe('test_bot');
  });
});
