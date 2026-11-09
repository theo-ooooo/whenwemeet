import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { AvatarsService } from './avatars.service.js';

@Module({
  imports: [FilesModule, StorageModule],
  providers: [AvatarsService],
  exports: [AvatarsService],
})
export class AvatarsModule {}
