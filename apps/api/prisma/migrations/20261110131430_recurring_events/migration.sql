-- AlterTable
ALTER TABLE `Event` ADD COLUMN `repeat` ENUM('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY') NULL,
    ADD COLUMN `repeatUntil` DATE NULL;

-- AlterTable
ALTER TABLE `EventLog` ADD COLUMN `occurrence` DATE NULL,
    ADD COLUMN `repeat` ENUM('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY') NULL,
    ADD COLUMN `scope` ENUM('THIS', 'FOLLOWING') NULL;

-- CreateTable
CREATE TABLE `EventException` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventId` INTEGER NOT NULL,
    `occurrence` DATE NOT NULL,
    `cancelled` BOOLEAN NOT NULL DEFAULT false,
    `title` VARCHAR(50) NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `allDay` BOOLEAN NULL,
    `memo` VARCHAR(500) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EventException_eventId_occurrence_key`(`eventId`, `occurrence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Event_groupId_repeat_idx` ON `Event`(`groupId`, `repeat`);

-- AddForeignKey
ALTER TABLE `EventException` ADD CONSTRAINT `EventException_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
