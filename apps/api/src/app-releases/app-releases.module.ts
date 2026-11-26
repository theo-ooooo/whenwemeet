import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import {
  AdminAppReleasesController,
  AppVersionController,
} from './app-releases.controller.js';
import { AppReleasesRepository } from './app-releases.repository.js';
import { AppReleasesService } from './app-releases.service.js';

/** (#539) 앱 업데이트 안내: 기종별 최신, 최소 버전 (D-292) */
@Module({
  imports: [AdminModule],
  controllers: [AppVersionController, AdminAppReleasesController],
  providers: [AppReleasesRepository, AppReleasesService],
})
export class AppReleasesModule {}
