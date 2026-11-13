-- CreateTable
CREATE TABLE `CalendarFeed` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `groupId` INTEGER NOT NULL,
    `tokenSalt` CHAR(22) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `includeMemo` BOOLEAN NOT NULL DEFAULT false,
    `includeAnniversaries` BOOLEAN NOT NULL DEFAULT true,
    `lastFetchedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CalendarFeed_tokenHash_key`(`tokenHash`),
    INDEX `CalendarFeed_groupId_idx`(`groupId`),
    UNIQUE INDEX `CalendarFeed_userId_groupId_key`(`userId`, `groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CalendarFeed` ADD CONSTRAINT `CalendarFeed_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalendarFeed` ADD CONSTRAINT `CalendarFeed_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
