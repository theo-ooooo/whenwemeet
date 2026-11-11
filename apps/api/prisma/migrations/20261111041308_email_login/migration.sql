-- AlterTable
ALTER TABLE `AuthAccount` MODIFY `provider` ENUM('KAKAO', 'APPLE', 'GOOGLE', 'NAVER', 'DEV', 'EMAIL') NOT NULL;

-- CreateTable
CREATE TABLE `EmailLoginChallenge` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `linkTokenHash` CHAR(64) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `usedVia` ENUM('LINK', 'CODE') NULL,
    `invalidatedAt` DATETIME(3) NULL,
    `next` VARCHAR(512) NOT NULL DEFAULT '/',
    `ipHash` CHAR(64) NOT NULL,
    `isReview` BOOLEAN NOT NULL DEFAULT false,
    `sendStatus` ENUM('SENT', 'FAILED', 'SKIPPED') NOT NULL,
    `providerMessageId` VARCHAR(64) NULL,
    `signupTokenHash` CHAR(64) NULL,
    `signupExpiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmailLoginChallenge_linkTokenHash_key`(`linkTokenHash`),
    UNIQUE INDEX `EmailLoginChallenge_signupTokenHash_key`(`signupTokenHash`),
    INDEX `EmailLoginChallenge_email_createdAt_idx`(`email`, `createdAt`),
    INDEX `EmailLoginChallenge_ipHash_createdAt_idx`(`ipHash`, `createdAt`),
    INDEX `EmailLoginChallenge_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
