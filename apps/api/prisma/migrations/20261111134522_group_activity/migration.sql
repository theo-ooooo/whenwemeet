-- CreateTable
CREATE TABLE `GroupActivity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupId` INTEGER NOT NULL,
    `type` ENUM('ANNIVERSARY_CREATED', 'ANNIVERSARY_UPDATED', 'ANNIVERSARY_DELETED', 'MEMBER_JOINED', 'MEMBER_LEFT', 'MEMBER_DELETED', 'GROUP_RENAMED') NOT NULL,
    `actorId` INTEGER NULL,
    `actorName` VARCHAR(50) NOT NULL,
    `anniversaryId` INTEGER NULL,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GroupActivity_groupId_createdAt_idx`(`groupId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GroupActivity` ADD CONSTRAINT `GroupActivity_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GroupActivity` ADD CONSTRAINT `GroupActivity_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GroupActivity` ADD CONSTRAINT `GroupActivity_anniversaryId_fkey` FOREIGN KEY (`anniversaryId`) REFERENCES `Anniversary`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
