-- AlterTable
ALTER TABLE `GroupActivity` MODIFY `type` ENUM('ANNIVERSARY_CREATED', 'ANNIVERSARY_UPDATED', 'ANNIVERSARY_DELETED', 'MEMBER_JOINED', 'MEMBER_LEFT', 'MEMBER_DELETED', 'GROUP_RENAMED', 'EVENTS_IMPORTED', 'EVENT_RSVP', 'POLL_CREATED', 'POLL_CLOSED') NOT NULL;

-- AlterTable
ALTER TABLE `PushNotification` MODIFY `kind` ENUM('REMINDER', 'CHANGE', 'ANNIVERSARY', 'JOIN', 'WEEKLY', 'POLL') NOT NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `notifyPoll` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `Poll` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupId` INTEGER NOT NULL,
    `publicCode` CHAR(8) NOT NULL,
    `title` VARCHAR(50) NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `deadline` DATETIME(3) NULL,
    `allMembers` BOOLEAN NOT NULL DEFAULT true,
    `creatorId` INTEGER NULL,
    `eventId` INTEGER NULL,
    `decidedOptionId` INTEGER NULL,
    `deadlineNotifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Poll_publicCode_key`(`publicCode`),
    UNIQUE INDEX `Poll_eventId_key`(`eventId`),
    INDEX `Poll_groupId_status_idx`(`groupId`, `status`),
    INDEX `Poll_status_deadline_idx`(`status`, `deadline`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PollOption` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pollId` INTEGER NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `allDay` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `PollOption_pollId_startsAt_endsAt_key`(`pollId`, `startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PollVote` (
    `optionId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PollVote_userId_idx`(`userId`),
    PRIMARY KEY (`optionId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PollParticipant` (
    `pollId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,

    INDEX `PollParticipant_userId_idx`(`userId`),
    PRIMARY KEY (`pollId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Poll` ADD CONSTRAINT `Poll_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Poll` ADD CONSTRAINT `Poll_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Poll` ADD CONSTRAINT `Poll_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PollOption` ADD CONSTRAINT `PollOption_pollId_fkey` FOREIGN KEY (`pollId`) REFERENCES `Poll`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PollVote` ADD CONSTRAINT `PollVote_optionId_fkey` FOREIGN KEY (`optionId`) REFERENCES `PollOption`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PollVote` ADD CONSTRAINT `PollVote_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PollParticipant` ADD CONSTRAINT `PollParticipant_pollId_fkey` FOREIGN KEY (`pollId`) REFERENCES `Poll`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PollParticipant` ADD CONSTRAINT `PollParticipant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
