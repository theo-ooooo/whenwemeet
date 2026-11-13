-- (#376, D-249 2단계) #369 로 NotificationPreference, BirthdayReminder, AnniversaryReminder 행으로 옮긴 옛 칸 13개를 지운다.
-- v0.19.0 (코드가 옛 칸을 읽지도 쓰지도 않음) 이 운영에 나간 뒤의 다음 릴리스 (docs/운영/배포.md "컬럼 삭제는 두 릴리스로").

-- AlterTable
ALTER TABLE `User` DROP COLUMN `notifyReminder`,
    DROP COLUMN `notifyChange`,
    DROP COLUMN `notifyAnniversary`,
    DROP COLUMN `notifyJoin`,
    DROP COLUMN `notifyWeekly`,
    DROP COLUMN `notifyWeeklyNudge`,
    DROP COLUMN `notifyPoll`,
    DROP COLUMN `birthdayRemindDayOf`,
    DROP COLUMN `birthdayRemindDayBefore`,
    DROP COLUMN `birthdayRemindWeekBefore`;

-- AlterTable
ALTER TABLE `Anniversary` DROP COLUMN `remindDayOf`,
    DROP COLUMN `remindDayBefore`,
    DROP COLUMN `remindWeekBefore`;
