-- AlterTable
ALTER TABLE `GroupActivity` MODIFY `type` ENUM('ANNIVERSARY_CREATED', 'ANNIVERSARY_UPDATED', 'ANNIVERSARY_DELETED', 'MEMBER_JOINED', 'MEMBER_LEFT', 'MEMBER_DELETED', 'GROUP_RENAMED', 'EVENTS_IMPORTED') NOT NULL;

-- CreateTable
CREATE TABLE `EventImport` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupId` INTEGER NOT NULL,
    `userId` INTEGER NULL,
    `created` INTEGER NOT NULL DEFAULT 0,
    `doneAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EventImport_groupId_idx`(`groupId`),
    INDEX `EventImport_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EventImportItem` (
    `importId` INTEGER NOT NULL,
    `groupId` INTEGER NOT NULL,
    `uidHash` CHAR(64) NOT NULL,
    `eventId` INTEGER NULL,

    INDEX `EventImportItem_eventId_idx`(`eventId`),
    UNIQUE INDEX `EventImportItem_groupId_uidHash_key`(`groupId`, `uidHash`),
    PRIMARY KEY (`importId`, `uidHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EventImport` ADD CONSTRAINT `EventImport_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventImport` ADD CONSTRAINT `EventImport_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventImportItem` ADD CONSTRAINT `EventImportItem_importId_fkey` FOREIGN KEY (`importId`) REFERENCES `EventImport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventImportItem` ADD CONSTRAINT `EventImportItem_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
