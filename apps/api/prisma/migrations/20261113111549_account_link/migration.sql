-- (#198) 로그인 방법 연결 (D-257). 추가만 한다.
-- migrate dev 가 함께 만든 Anniversary.remind*, User.birthdayRemind*, User.notify* 삭제는 뺐다
-- (#369 에서 표로 옮긴 옛 칸. 삭제는 #376 이 따로 한다)

-- AlterTable
ALTER TABLE `EmailLoginChallenge` ADD COLUMN `purpose` ENUM('LOGIN', 'LINK') NOT NULL DEFAULT 'LOGIN',
    ADD COLUMN `userId` INTEGER NULL;

-- CreateTable
CREATE TABLE `AuthLinkTicket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `provider` ENUM('KAKAO', 'APPLE', 'GOOGLE', 'NAVER', 'DEV', 'EMAIL') NOT NULL,
    `providerUserId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(255) NULL,
    `rawProfile` JSON NULL,
    `providerClientId` VARCHAR(191) NULL,
    `refreshToken` TEXT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AuthLinkTicket_tokenHash_key`(`tokenHash`),
    INDEX `AuthLinkTicket_userId_idx`(`userId`),
    INDEX `AuthLinkTicket_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AuthLinkTicket` ADD CONSTRAINT `AuthLinkTicket_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
