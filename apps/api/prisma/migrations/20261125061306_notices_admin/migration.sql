-- (#515, D-285, D-286) 공지사항과 관리자: Notice, AdminAction 표 추가. User 에 역할(기본 user)과 공지 본 시각, Group 과 Event 에 운영 숨김 열(null 허용) 추가. 기존 행은 모두 user, 숨기지 않음
-- AlterTable
ALTER TABLE `Event` ADD COLUMN `hiddenAt` DATETIME(3) NULL,
    ADD COLUMN `hiddenById` INTEGER NULL,
    ADD COLUMN `hiddenReason` VARCHAR(200) NULL;

-- AlterTable
ALTER TABLE `Group` ADD COLUMN `hiddenAt` DATETIME(3) NULL,
    ADD COLUMN `hiddenById` INTEGER NULL,
    ADD COLUMN `hiddenReason` VARCHAR(200) NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `noticesSeenAt` DATETIME(3) NULL,
    ADD COLUMN `role` ENUM('user', 'admin') NOT NULL DEFAULT 'user';

-- CreateTable
CREATE TABLE `AdminAction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `adminId` INTEGER NULL,
    `action` ENUM('notice_create', 'notice_update', 'notice_delete', 'user_role', 'group_hide', 'group_unhide', 'group_delete', 'event_hide', 'event_unhide', 'event_delete') NOT NULL,
    `targetType` ENUM('notice', 'user', 'group', 'event') NOT NULL,
    `targetId` INTEGER NOT NULL,
    `reason` VARCHAR(200) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminAction_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(100) NOT NULL,
    `body` TEXT NOT NULL,
    `kind` ENUM('notice', 'update', 'maintenance') NOT NULL DEFAULT 'notice',
    `pinned` BOOLEAN NOT NULL DEFAULT false,
    `publishedAt` DATETIME(3) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Notice_publishedAt_idx`(`publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AdminAction` ADD CONSTRAINT `AdminAction_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notice` ADD CONSTRAINT `Notice_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Group` ADD CONSTRAINT `Group_hiddenById_fkey` FOREIGN KEY (`hiddenById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Event` ADD CONSTRAINT `Event_hiddenById_fkey` FOREIGN KEY (`hiddenById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
