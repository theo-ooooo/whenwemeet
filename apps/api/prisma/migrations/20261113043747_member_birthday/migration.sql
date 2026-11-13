-- AlterTable
ALTER TABLE `Membership` ADD COLUMN `showBirthday` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `birthday` CHAR(5) NULL,
    ADD COLUMN `birthdayRemindDayBefore` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `birthdayRemindDayOf` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `birthdayRemindWeekBefore` BOOLEAN NOT NULL DEFAULT false;
