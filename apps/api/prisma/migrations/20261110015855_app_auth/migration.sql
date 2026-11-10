-- AlterTable
ALTER TABLE `AuthAccount` ADD COLUMN `providerClientId` VARCHAR(191) NULL,
    ADD COLUMN `refreshToken` TEXT NULL;

-- CreateTable
CREATE TABLE `AuthHandoff` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `codeChallenge` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AuthHandoff_tokenHash_key`(`tokenHash`),
    INDEX `AuthHandoff_userId_idx`(`userId`),
    INDEX `AuthHandoff_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AuthHandoff` ADD CONSTRAINT `AuthHandoff_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
