-- AlterTable
ALTER TABLE `GroupActivity` MODIFY `type` ENUM('ANNIVERSARY_CREATED', 'ANNIVERSARY_UPDATED', 'ANNIVERSARY_DELETED', 'MEMBER_JOINED', 'MEMBER_LEFT', 'MEMBER_DELETED', 'GROUP_RENAMED', 'EVENTS_IMPORTED', 'EVENT_RSVP') NOT NULL;

-- CreateTable
CREATE TABLE `EventRsvp` (
    `eventId` INTEGER NOT NULL,
    `occurrence` DATE NOT NULL,
    `userId` INTEGER NOT NULL,
    `status` ENUM('GOING', 'NOT_GOING', 'MAYBE') NOT NULL,
    `seenStartsAt` DATETIME(3) NOT NULL,
    `seenEndsAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EventRsvp_userId_idx`(`userId`),
    PRIMARY KEY (`eventId`, `occurrence`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EventReaction` (
    `eventId` INTEGER NOT NULL,
    `occurrence` DATE NOT NULL,
    `userId` INTEGER NOT NULL,
    `kind` ENUM('LIKE', 'EXCITED', 'ACK') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EventReaction_userId_idx`(`userId`),
    PRIMARY KEY (`eventId`, `occurrence`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EventRsvp` ADD CONSTRAINT `EventRsvp_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventRsvp` ADD CONSTRAINT `EventRsvp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventReaction` ADD CONSTRAINT `EventReaction_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventReaction` ADD CONSTRAINT `EventReaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
