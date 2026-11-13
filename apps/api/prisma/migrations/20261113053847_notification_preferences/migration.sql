-- (#369, D-249) 같은 성격의 값을 칸으로 늘어놓은 반복 그룹을 자식 행으로 옮긴다.
--   User.notify* 7칸            → NotificationPreference(userId, kind, enabled). 행이 없으면 코드의 기본값이라 기본값과 다른 값만 옮긴다
--   Anniversary.remind* 3칸      → AnniversaryReminder(anniversaryId, offset). 켜진 시점마다 행 하나
--   User.birthdayRemind* 3칸     → BirthdayReminder(userId, offset). 켜진 시점마다 행 하나
-- 옛 칸은 이 릴리스에서는 남겨 두고(새 코드는 읽지도 쓰지도 않음) 다음 릴리스에서 DROP 한다 (docs/운영/배포.md 두 릴리스 규칙, 이전 이미지 롤백 안전).
-- 다시 돌려도 같은 결과: 표는 있으면 두고, 옮긴 행을 지운 뒤 지금의 옛 칸에서 다시 옮긴다.
-- (이 마이그레이션이 성공하기 전에는 새 코드가 뜨지 않으므로 세 표에는 이 파일이 넣은 행만 있다)

-- CreateTable
CREATE TABLE IF NOT EXISTS `NotificationPreference` (
    `userId` INTEGER NOT NULL,
    `kind` ENUM('REMINDER', 'CHANGE', 'ANNIVERSARY', 'JOIN', 'WEEKLY', 'WEEKLY_NUDGE', 'POLL') NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`, `kind`),
    CONSTRAINT `NotificationPreference_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `AnniversaryReminder` (
    `anniversaryId` INTEGER NOT NULL,
    `offset` ENUM('DAY_OF', 'DAY_BEFORE', 'WEEK_BEFORE') NOT NULL,

    PRIMARY KEY (`anniversaryId`, `offset`),
    CONSTRAINT `AnniversaryReminder_anniversaryId_fkey` FOREIGN KEY (`anniversaryId`) REFERENCES `Anniversary`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `BirthdayReminder` (
    `userId` INTEGER NOT NULL,
    `offset` ENUM('DAY_OF', 'DAY_BEFORE', 'WEEK_BEFORE') NOT NULL,

    PRIMARY KEY (`userId`, `offset`),
    CONSTRAINT `BirthdayReminder_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 데이터 이전 1: 알림 종류. 기본값(켬: REMINDER CHANGE ANNIVERSARY JOIN WEEKLY POLL, 끔: WEEKLY_NUDGE)과 다른 칸만
DELETE FROM `NotificationPreference`;
INSERT INTO `NotificationPreference` (`userId`, `kind`, `enabled`, `updatedAt`)
          SELECT `id`, 'REMINDER',     false, CURRENT_TIMESTAMP(3) FROM `User` WHERE `notifyReminder` = false
UNION ALL SELECT `id`, 'CHANGE',       false, CURRENT_TIMESTAMP(3) FROM `User` WHERE `notifyChange` = false
UNION ALL SELECT `id`, 'ANNIVERSARY',  false, CURRENT_TIMESTAMP(3) FROM `User` WHERE `notifyAnniversary` = false
UNION ALL SELECT `id`, 'JOIN',         false, CURRENT_TIMESTAMP(3) FROM `User` WHERE `notifyJoin` = false
UNION ALL SELECT `id`, 'WEEKLY',       false, CURRENT_TIMESTAMP(3) FROM `User` WHERE `notifyWeekly` = false
UNION ALL SELECT `id`, 'WEEKLY_NUDGE', true,  CURRENT_TIMESTAMP(3) FROM `User` WHERE `notifyWeeklyNudge` = true
UNION ALL SELECT `id`, 'POLL',         false, CURRENT_TIMESTAMP(3) FROM `User` WHERE `notifyPoll` = false;

-- 데이터 이전 2: 기념일 알림 시점. 켜진 칸마다 행 하나 (모두 끈 기념일은 행 없음 = 알림 없음)
DELETE FROM `AnniversaryReminder`;
INSERT INTO `AnniversaryReminder` (`anniversaryId`, `offset`)
          SELECT `id`, 'DAY_OF'      FROM `Anniversary` WHERE `remindDayOf` = true
UNION ALL SELECT `id`, 'DAY_BEFORE'  FROM `Anniversary` WHERE `remindDayBefore` = true
UNION ALL SELECT `id`, 'WEEK_BEFORE' FROM `Anniversary` WHERE `remindWeekBefore` = true;

-- 데이터 이전 3: 내 생일 알림 시점. 켜진 칸마다 행 하나
DELETE FROM `BirthdayReminder`;
INSERT INTO `BirthdayReminder` (`userId`, `offset`)
          SELECT `id`, 'DAY_OF'      FROM `User` WHERE `birthdayRemindDayOf` = true
UNION ALL SELECT `id`, 'DAY_BEFORE'  FROM `User` WHERE `birthdayRemindDayBefore` = true
UNION ALL SELECT `id`, 'WEEK_BEFORE' FROM `User` WHERE `birthdayRemindWeekBefore` = true;
