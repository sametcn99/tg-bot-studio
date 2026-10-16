import { MODULE_REGISTRY } from '../bot-engine/module-registry';
import { safeJsonObjectParse } from '../common/utils/json.util';
import type { BotModel } from './bot.model';

/**
 * Registry entry merged with its persisted bot_modules row.
 */
export interface ModuleState {
  key: string;
  name: string;
  category: string;
  description: string;
  isEnabled: boolean;
  config: Record<string, unknown>;
}

/**
 * Lists every module of a bot as registry defaults merged over the stored
 * config (shared by the dashboard listing and the diagnostics inspector).
 * @param {BotModel} botModel - Bot model for module rows.
 * @param {number} botId - Owning bot id.
 * @returns {Promise<ModuleState[]>} Registry order, config unmasked.
 */
export async function listModuleStates(botModel: BotModel, botId: number): Promise<ModuleState[]> {
  const rows = await botModel.listModules(botId);
  const byKey = new Map(rows.map((row) => [row.moduleKey, row]));

  return MODULE_REGISTRY.map((definition) => {
    const row = byKey.get(definition.key);
    const stored = safeJsonObjectParse(
      row?.configJson,
      {},
      `bot_modules:${botId}:${definition.key}`,
    );
    return {
      key: definition.key,
      name: definition.name,
      category: definition.category,
      description: definition.description,
      isEnabled: Boolean(row?.isEnabled),
      config: { ...definition.defaultConfig, ...stored },
    };
  });
}
