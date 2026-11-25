-- AlterTable
ALTER TABLE `Notice` ADD COLUMN `popup` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `NoticeDismissal` (
    `userId` INTEGER NOT NULL,
    `noticeId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NoticeDismissal_noticeId_idx`(`noticeId`),
    PRIMARY KEY (`userId`, `noticeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NoticeDismissal` ADD CONSTRAINT `NoticeDismissal_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NoticeDismissal` ADD CONSTRAINT `NoticeDismissal_noticeId_fkey` FOREIGN KEY (`noticeId`) REFERENCES `Notice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
