import { Injectable, NotFoundException } from '@nestjs/common';
import type { BotTemplate } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Model managing saved bot configuration templates via Prisma.
 */
@Injectable()
export class BotTemplateModel {
  /**
   * @param {PrismaService} prisma - Prisma ORM access service.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists every saved template, newest first.
   * @returns {Promise<BotTemplate[]>} Template rows.
   */
  async list(): Promise<BotTemplate[]> {
    return this.prisma.botTemplate.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /**
   * Finds one template.
   * @throws {NotFoundException} When the template does not exist.
   */
  async findById(id: string): Promise<BotTemplate> {
    const row = await this.prisma.botTemplate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Template ${id} not found`);
    return row;
  }

  /**
   * Saves a template from an export bundle.
   */
  async create(data: {
    name: string;
    description?: string | null;
    bundleJson: string;
    sourceBotName?: string | null;
  }): Promise<BotTemplate> {
    return this.prisma.botTemplate.create({
      data: { ...data, createdAt: new Date().toISOString() },
    });
  }

  /**
   * Deletes a template.
   * @throws {NotFoundException} When the template does not exist.
   */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.botTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Template ${id} not found`);
    await this.prisma.botTemplate.delete({ where: { id } });
  }
}
