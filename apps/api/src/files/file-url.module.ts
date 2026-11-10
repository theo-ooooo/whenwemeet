import { Global, Module } from '@nestjs/common';
import { FileUrlBuilder } from './file-url.builder.js';

/** 사람 정보를 읽는 Repository 대부분이 쓰므로 전역 (결정기록 D-56) */
@Global()
@Module({
  providers: [FileUrlBuilder],
  exports: [FileUrlBuilder],
})
export class FileUrlModule {}
