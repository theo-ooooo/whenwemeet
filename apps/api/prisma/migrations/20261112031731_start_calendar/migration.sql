-- AlterTable
ALTER TABLE `User` ADD COLUMN `startCalendarMode` ENUM('LAST', 'PERSONAL', 'GROUP') NOT NULL DEFAULT 'LAST',
    ADD COLUMN `startGroupId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_startGroupId_fkey` FOREIGN KEY (`startGroupId`) REFERENCES `Group`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
