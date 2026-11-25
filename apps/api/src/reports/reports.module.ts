import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsRepository } from './reports.repository.js';
import { ReportsService } from './reports.service.js';

/** (#536) 사용자 신고 접수 (D-289). 관리자 처리는 AdminModule 의 신고 탭 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsRepository, ReportsService],
})
export class ReportsModule {}
