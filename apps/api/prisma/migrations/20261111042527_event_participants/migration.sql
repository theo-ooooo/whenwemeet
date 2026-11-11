-- AlterTable
ALTER TABLE `Event` ADD COLUMN `allMembers` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `EventLog` ADD COLUMN `participantIds` JSON NULL,
    ADD COLUMN `participantsAll` BOOLEAN NULL;

-- CreateTable
CREATE TABLE `EventParticipant` (
    `eventId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,

    INDEX `EventParticipant_userId_idx`(`userId`),
    PRIMARY KEY (`eventId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EventParticipant` ADD CONSTRAINT `EventParticipant_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventParticipant` ADD CONSTRAINT `EventParticipant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
