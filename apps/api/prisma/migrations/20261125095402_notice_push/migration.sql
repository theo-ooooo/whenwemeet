/*
  Warnings:

  - The primary key for the `NotificationPreference` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE `AdminAction` MODIFY `action` ENUM('notice_create', 'notice_update', 'notice_delete', 'user_role', 'group_hide', 'group_unhide', 'group_delete', 'event_hide', 'event_unhide', 'event_delete', 'notice_push') NOT NULL;

-- AlterTable
ALTER TABLE `Notice` ADD COLUMN `pushedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `NotificationPreference` DROP PRIMARY KEY,
    MODIFY `kind` ENUM('REMINDER', 'CHANGE', 'ANNIVERSARY', 'JOIN', 'WEEKLY', 'WEEKLY_NUDGE', 'POLL', 'NOTICE') NOT NULL,
    ADD PRIMARY KEY (`userId`, `kind`);

-- AlterTable
ALTER TABLE `PushNotification` MODIFY `kind` ENUM('REMINDER', 'CHANGE', 'ANNIVERSARY', 'JOIN', 'WEEKLY', 'POLL', 'NOTICE') NOT NULL,
    MODIFY `groupId` INTEGER NULL;
