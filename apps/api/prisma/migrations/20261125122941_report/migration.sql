-- AlterTable
ALTER TABLE `AdminAction` MODIFY `action` ENUM('notice_create', 'notice_update', 'notice_delete', 'user_role', 'group_hide', 'group_unhide', 'group_delete', 'event_hide', 'event_unhide', 'event_delete', 'notice_push', 'app_release_update', 'report_resolve', 'report_dismiss') NOT NULL;

-- CreateTable
CREATE TABLE `Report` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reporterId` INTEGER NULL,
    `targetType` ENUM('group', 'event', 'user') NOT NULL,
    `targetId` INTEGER NOT NULL,
    `reason` ENUM('spam', 'abuse', 'illegal', 'privacy', 'other') NOT NULL,
    `detail` VARCHAR(500) NULL,
    `status` ENUM('open', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
    `resolvedById` INTEGER NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolution` VARCHAR(200) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Report_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Report_targetType_targetId_idx`(`targetType`, `targetId`),
    INDEX `Report_reporterId_idx`(`reporterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Report` ADD CONSTRAINT `Report_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Report` ADD CONSTRAINT `Report_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
