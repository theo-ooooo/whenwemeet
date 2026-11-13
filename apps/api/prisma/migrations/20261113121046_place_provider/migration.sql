-- (D-259) 고른 장소의 출처. 추가만 (null = 카카오, 이전 행). 네이버 장소는 placeId 에 이름 + 주소 해시 키
-- AlterTable
ALTER TABLE `Event` ADD COLUMN `placeProvider` ENUM('KAKAO', 'NAVER') NULL;

-- AlterTable
ALTER TABLE `EventException` ADD COLUMN `placeProvider` ENUM('KAKAO', 'NAVER') NULL;
