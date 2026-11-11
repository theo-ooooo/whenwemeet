-- AlterTable
ALTER TABLE `Event` ADD COLUMN `remindAt` DATETIME(3) NULL,
    ADD COLUMN `reminder` ENUM('NONE', 'AT_START', 'MIN_10', 'HOUR_1', 'DAY_1', 'DAY_OF_0900', 'DAY_BEFORE_0900') NOT NULL DEFAULT 'NONE',
    ADD COLUMN `reminderSetAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `EventException` ADD COLUMN `reminder` ENUM('NONE', 'AT_START', 'MIN_10', 'HOUR_1', 'DAY_1', 'DAY_OF_0900', 'DAY_BEFORE_0900') NULL,
    ADD COLUMN `reminderSetAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Membership` ADD COLUMN `notify` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `lastAppLoginAt` DATETIME(3) NULL,
    ADD COLUMN `notifyAnniversary` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `notifyChange` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `notifyJoin` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `notifyReminder` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `PushDevice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `token` VARCHAR(200) NOT NULL,
    `platform` ENUM('IOS', 'ANDROID') NOT NULL,
    `appVersion` VARCHAR(20) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PushDevice_token_key`(`token`),
    INDEX `PushDevice_userId_lastSeenAt_idx`(`userId`, `lastSeenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushNotification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('REMINDER', 'CHANGE', 'ANNIVERSARY', 'JOIN') NOT NULL,
    `dedupeKey` VARCHAR(120) NOT NULL,
    `groupId` INTEGER NOT NULL,
    `scheduledAt` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'DISPATCHED', 'CANCELLED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `coalesceKey` VARCHAR(40) NULL,
    `changeAction` ENUM('CREATED', 'UPDATED', 'DELETED') NULL,
    `eventId` INTEGER NULL,
    `occurrence` DATE NULL,
    `eventLogId` INTEGER NULL,
    `anniversaryId` INTEGER NULL,
    `actorId` INTEGER NULL,
    `payload` JSON NULL,
    `dispatchedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PushNotification_dedupeKey_key`(`dedupeKey`),
    INDEX `PushNotification_status_scheduledAt_idx`(`status`, `scheduledAt`),
    INDEX `PushNotification_coalesceKey_status_idx`(`coalesceKey`, `status`),
    INDEX `PushNotification_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushDelivery` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `notificationId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `token` VARCHAR(200) NOT NULL,
    `platform` ENUM('IOS', 'ANDROID') NOT NULL,
    `status` ENUM('QUEUED', 'SENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `ticketId` VARCHAR(64) NULL,
    `error` VARCHAR(64) NULL,
    `receipt` VARCHAR(64) NULL,
    `sentAt` DATETIME(3) NULL,
    `receiptCheckedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PushDelivery_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `PushDelivery_status_receiptCheckedAt_sentAt_idx`(`status`, `receiptCheckedAt`, `sentAt`),
    UNIQUE INDEX `PushDelivery_notificationId_token_key`(`notificationId`, `token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchedulerLease` (
    `name` VARCHAR(40) NOT NULL,
    `holder` VARCHAR(40) NULL,
    `leaseUntil` DATETIME(3) NOT NULL,
    `cursor` DATETIME(3) NULL,
    `dailyDoneOn` DATE NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Event_remindAt_idx` ON `Event`(`remindAt`);

-- CreateIndex
CREATE INDEX `Event_reminder_repeat_idx` ON `Event`(`reminder`, `repeat`);

-- AddForeignKey
ALTER TABLE `PushDevice` ADD CONSTRAINT `PushDevice_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushNotification` ADD CONSTRAINT `PushNotification_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushDelivery` ADD CONSTRAINT `PushDelivery_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `PushNotification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushDelivery` ADD CONSTRAINT `PushDelivery_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 예약 작업 임대 행 (설계 푸시-알림.md 3장 4번, D-87). 손으로 덧붙인 데이터 한 줄
INSERT INTO `SchedulerLease` (`name`, `leaseUntil`, `updatedAt`) VALUES ('push', '1970-01-01 00:00:00.000', NOW(3));
