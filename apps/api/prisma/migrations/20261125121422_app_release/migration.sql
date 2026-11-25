-- AlterTable
ALTER TABLE `AdminAction` MODIFY `action` ENUM('notice_create', 'notice_update', 'notice_delete', 'user_role', 'group_hide', 'group_unhide', 'group_delete', 'event_hide', 'event_unhide', 'event_delete', 'notice_push', 'app_release_update') NOT NULL,
    MODIFY `targetType` ENUM('notice', 'user', 'group', 'event', 'app_release') NOT NULL;

-- CreateTable
CREATE TABLE `AppRelease` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `platform` ENUM('ios', 'android') NOT NULL,
    `latestVersion` VARCHAR(32) NULL,
    `minVersion` VARCHAR(32) NULL,
    `storeUrl` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AppRelease_platform_key`(`platform`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
