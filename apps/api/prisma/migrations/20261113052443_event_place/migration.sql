-- AlterTable
ALTER TABLE `Event` ADD COLUMN `placeAddress` VARCHAR(200) NULL,
    ADD COLUMN `placeKakaoId` VARCHAR(20) NULL,
    ADD COLUMN `placeLat` DOUBLE NULL,
    ADD COLUMN `placeLng` DOUBLE NULL,
    ADD COLUMN `placeName` VARCHAR(100) NULL;

-- AlterTable
ALTER TABLE `EventException` ADD COLUMN `placeAddress` VARCHAR(200) NULL,
    ADD COLUMN `placeKakaoId` VARCHAR(20) NULL,
    ADD COLUMN `placeLat` DOUBLE NULL,
    ADD COLUMN `placeLng` DOUBLE NULL,
    ADD COLUMN `placeName` VARCHAR(100) NULL;
