-- CreateTable
CREATE TABLE `EventShare` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(32) NOT NULL,
    `groupId` INTEGER NOT NULL,
    `eventId` INTEGER NOT NULL,
    `occurrence` DATE NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `joinCount` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `EventShare_token_key`(`token`),
    INDEX `EventShare_eventId_occurrence_idx`(`eventId`, `occurrence`),
    INDEX `EventShare_groupId_idx`(`groupId`),
    INDEX `EventShare_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EventShare` ADD CONSTRAINT `EventShare_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventShare` ADD CONSTRAINT `EventShare_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventShare` ADD CONSTRAINT `EventShare_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
