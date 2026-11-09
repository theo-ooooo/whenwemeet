import { Module } from '@nestjs/common';
import { FilesRepository } from './files.repository.js';

@Module({
  providers: [FilesRepository],
  exports: [FilesRepository],
})
export class FilesModule {}
