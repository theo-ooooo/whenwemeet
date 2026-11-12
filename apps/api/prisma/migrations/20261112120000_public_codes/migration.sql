-- (#311) 팀, 일정 공개 코드 (주소에서 내부 번호 대신 쓴다).
-- 기존 행은 여기서 채운다: NULL 로 더한 뒤 앱과 같은 알파벳(abcdefghijkmnpqrstuvwxyz23456789, 8자)으로 랜덤 코드를 넣고 NOT NULL + UNIQUE 로 바꾼다.
-- UPDATE 는 publicCode 가 NULL 인 행만 건드려 다시 돌려도 같은 결과(멱등)다. 행이 수십 개라 충돌 확률(32^8 공간)은 무시할 수 있고, 충돌하면 UNIQUE 생성이 실패해 마이그레이션이 멈춘다 (다시 실행하면 된다)

-- AlterTable
ALTER TABLE `Group` ADD COLUMN `publicCode` CHAR(8) NULL;

-- AlterTable
ALTER TABLE `Event` ADD COLUMN `publicCode` CHAR(8) NULL;

-- Backfill
UPDATE `Group` SET `publicCode` = CONCAT(
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1)
) WHERE `publicCode` IS NULL;

UPDATE `Event` SET `publicCode` = CONCAT(
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1),
  SUBSTRING('abcdefghijkmnpqrstuvwxyz23456789', FLOOR(1 + RAND() * 32), 1)
) WHERE `publicCode` IS NULL;

-- AlterTable
ALTER TABLE `Group` MODIFY `publicCode` CHAR(8) NOT NULL;

-- AlterTable
ALTER TABLE `Event` MODIFY `publicCode` CHAR(8) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Group_publicCode_key` ON `Group`(`publicCode`);

-- CreateIndex
CREATE UNIQUE INDEX `Event_publicCode_key` ON `Event`(`publicCode`);
