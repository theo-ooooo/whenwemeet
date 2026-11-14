-- (#444, D-263) 참여자 "모두"(allMembers = true, 팀 전체 동적) 를 없앤다.
-- 기존 "모두" 일정과 투표에 이 마이그레이션 시점의 팀 멤버 전원을 참여자 행으로 넣고 allMembers 를 false 로 바꾼다.
-- 반복 일정의 참여자는 원본(Event 행)에만 붙고 회차 예외(EventException)에는 없으므로 Event 행만 보면 된다 (D-130).
-- 멤버 0명 팀의 "모두" 는 행 없이 false 가 되어 "참여자 없음" 이 된다.
-- 다시 돌려도 같은 결과가 되게 (실패 후 재실행) 이미 있는 행은 건너뛴다.

-- 1) "모두" 일정: 지금 멤버 전원을 참여자 행으로
INSERT INTO `EventParticipant` (`eventId`, `userId`)
SELECT e.`id`, m.`userId`
FROM `Event` e
JOIN `Membership` m ON m.`groupId` = e.`groupId`
WHERE e.`allMembers` = true
  AND NOT EXISTS (SELECT 1 FROM `EventParticipant` p WHERE p.`eventId` = e.`id` AND p.`userId` = m.`userId`);

-- 2) 행을 넣은 일정(또는 멤버가 없는 팀의 일정)만 false 로. 1) 과 2) 사이에 배포 중 옛 API 가 만든 "모두" 일정은
--    행이 없으니 true 로 남는다 (읽기는 계속 지금 멤버 전원으로 보므로 "참여자 없음" 으로 바뀌지 않는다)
UPDATE `Event` e
SET e.`allMembers` = false
WHERE e.`allMembers` = true
  AND (
    EXISTS (SELECT 1 FROM `EventParticipant` p WHERE p.`eventId` = e.`id`)
    OR NOT EXISTS (SELECT 1 FROM `Membership` m WHERE m.`groupId` = e.`groupId`)
  );

-- 3) "모두" 투표: 같은 규칙
INSERT INTO `PollParticipant` (`pollId`, `userId`)
SELECT o.`id`, m.`userId`
FROM `Poll` o
JOIN `Membership` m ON m.`groupId` = o.`groupId`
WHERE o.`allMembers` = true
  AND NOT EXISTS (SELECT 1 FROM `PollParticipant` p WHERE p.`pollId` = o.`id` AND p.`userId` = m.`userId`);

UPDATE `Poll` o
SET o.`allMembers` = false
WHERE o.`allMembers` = true
  AND (
    EXISTS (SELECT 1 FROM `PollParticipant` p WHERE p.`pollId` = o.`id`)
    OR NOT EXISTS (SELECT 1 FROM `Membership` m WHERE m.`groupId` = o.`groupId`)
  );

-- 4) 기본값 false. 서비스는 항상 값을 넣으므로 기본값은 값을 빠뜨린 경로의 안전판이다
-- AlterTable
ALTER TABLE `Event` MODIFY `allMembers` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Poll` MODIFY `allMembers` BOOLEAN NOT NULL DEFAULT false;
