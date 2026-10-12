import { Module } from '@nestjs/common';
import { StartMenuController } from './start-menu.controller';
import { StartMenuService } from './start-menu.service';
import { StartMenuRuntime } from './start-menu.runtime';

/**
 * Start Menu feature module: consolidated /start menu for chat folders
 * (addlist), channels, groups, and web links with click analytics.
 */
@Module({
  controllers: [StartMenuController],
  providers: [StartMenuService, StartMenuRuntime],
  exports: [StartMenuService],
})
export class StartMenuModule {}
