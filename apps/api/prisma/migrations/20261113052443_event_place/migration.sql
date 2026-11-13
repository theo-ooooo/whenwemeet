-- AlterTable
ALTER TABLE `Event` ADD COLUMN `placeId` VARCHAR(20) NULL,
    ADD COLUMN `placeQuery` VARCHAR(100) NULL,
    ADD COLUMN `placeText` VARCHAR(100) NULL;

-- AlterTable
ALTER TABLE `EventException` ADD COLUMN `placeId` VARCHAR(20) NULL,
    ADD COLUMN `placeQuery` VARCHAR(100) NULL,
    ADD COLUMN `placeText` VARCHAR(100) NULL;
