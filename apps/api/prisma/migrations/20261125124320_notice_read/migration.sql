-- CreateTable
CREATE TABLE `NoticeRead` (
    `userId` INTEGER NOT NULL,
    `noticeId` INTEGER NOT NULL,
    `firstReadAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `via` ENUM('list', 'detail', 'push', 'popup', 'banner') NOT NULL,

    INDEX `NoticeRead_noticeId_firstReadAt_idx`(`noticeId`, `firstReadAt`),
    PRIMARY KEY (`userId`, `noticeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NoticeRead` ADD CONSTRAINT `NoticeRead_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NoticeRead` ADD CONSTRAINT `NoticeRead_noticeId_fkey` FOREIGN KEY (`noticeId`) REFERENCES `Notice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
