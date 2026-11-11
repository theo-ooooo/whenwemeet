-- AlterTable
ALTER TABLE `Anniversary` ADD COLUMN `remindDayBefore` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `remindDayOf` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `remindWeekBefore` BOOLEAN NOT NULL DEFAULT false;
