-- CreateTable
CREATE TABLE `EventDeletion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupId` INTEGER NOT NULL,
    `eventId` INTEGER NOT NULL,
    `kind` ENUM('EVENT', 'OCCURRENCE', 'FOLLOWING') NOT NULL,
    `occurrence` DATE NULL,
    `actorId` INTEGER NULL,
    `eventLogId` INTEGER NULL,
    `snapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EventDeletion_groupId_idx`(`groupId`),
    INDEX `EventDeletion_actorId_idx`(`actorId`),
    INDEX `EventDeletion_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EventDeletion` ADD CONSTRAINT `EventDeletion_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventDeletion` ADD CONSTRAINT `EventDeletion_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
