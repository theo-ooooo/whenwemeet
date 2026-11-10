-- AlterTable
ALTER TABLE `User` DROP COLUMN `profileImageUrl`,
    ADD COLUMN `avatarFileId` INTEGER NULL;

-- CreateTable
CREATE TABLE `File` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider` ENUM('R2', 'LOCAL') NOT NULL DEFAULT 'R2',
    `bucket` VARCHAR(100) NOT NULL,
    `key` VARCHAR(300) NOT NULL,
    `publicUrl` VARCHAR(500) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `kind` ENUM('AVATAR', 'EVENT_PHOTO', 'GROUP_COVER') NOT NULL,
    `ownerId` INTEGER NOT NULL,
    `sourceUrl` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `File_ownerId_kind_idx`(`ownerId`, `kind`),
    UNIQUE INDEX `File_bucket_key_key`(`bucket`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `User_avatarFileId_key` ON `User`(`avatarFileId`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_avatarFileId_fkey` FOREIGN KEY (`avatarFileId`) REFERENCES `File`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `File` ADD CONSTRAINT `File_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
