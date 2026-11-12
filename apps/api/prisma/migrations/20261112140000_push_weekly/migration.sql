-- AlterTable
ALTER TABLE `PushNotification` MODIFY `kind` ENUM('REMINDER', 'CHANGE', 'ANNIVERSARY', 'JOIN', 'WEEKLY') NOT NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `notifyWeekly` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `notifyWeeklyNudge` BOOLEAN NOT NULL DEFAULT false;

-- (#277) 주간 알림을 예약한 월요일을 적는 행 (D-203). 'push' 행과 같은 방식
INSERT INTO `SchedulerLease` (`name`, `leaseUntil`, `updatedAt`) VALUES ('weekly', '1970-01-01 00:00:00.000', NOW(3));
