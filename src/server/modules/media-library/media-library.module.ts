import { Module } from '@nestjs/common';
import { MediaLibraryController } from './media-library.controller';
import { MediaLibraryService } from './media-library.service';

/**
 * Shared media library feature module. The `MediaAssetModel` domain model is
 * provided globally by the database module.
 */
@Module({
  controllers: [MediaLibraryController],
  providers: [MediaLibraryService],
  exports: [MediaLibraryService],
})
export class MediaLibraryModule {}
