-- (#450, D-269, D-270) AI 비서 볼까: 하루 사용 횟수 표 추가, User 에 동의 시각(null 허용) 열 추가. 기존 행은 바꾸지 않는다
-- AlterTable
ALTER TABLE `User` ADD COLUMN `assistantConsentAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `AssistantUsage` (
    `userId` INTEGER NOT NULL,
    `day` DATE NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`userId`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AssistantUsage` ADD CONSTRAINT `AssistantUsage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
