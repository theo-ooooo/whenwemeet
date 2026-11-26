---
name: wwm-release
description: 언제볼까 릴리스 절차. develop 에 머지된 변경을 버전 올림, develop → main 릴리스 PR, 태그, Railway 마이그레이션과 Vercel 운영 배포 확인까지. "배포해", "릴리스", "vX.Y.Z" 요청이나 기능 PR 머지 뒤에 쓴다. iOS/Android 앱 빌드와 제출도 포함.
---

# 언제볼까 릴리스

pstack 의 PR, CI 흐름(babysit 등)은 그대로 쓰고, 머지 뒤 배포는 이 순서를 지킨다.

## 1. 기능 PR → develop
- 브랜치 `<type>/<이슈>-<영문>`, PR 제목 `<type>: 메시지 (#이슈)`, 본문은 `.github/PULL_REQUEST_TEMPLATE.md`
- CI 는 `build` 체크뿐. 통과하면 **squash** 머지 (`gh pr merge <n> --squash --delete-branch`)

## 2. 버전 올림 PR → develop
- `apps/web/package.json` 의 `version` 만 올린다. 새 기능이나 마이그레이션은 minor, 화면 손질과 버그는 patch
- 브랜치 `chore/release-X.Y.Z`, 제목 `chore: vX.Y.Z`, squash 머지

## 3. 릴리스 PR develop → main
- `gh pr create --base main --head develop --title "release: vX.Y.Z"`
- **`build` 체크 2개가 모두 끝나 pass 인 것을 본 뒤** `gh pr merge <n> --merge` (squash 금지, #79)

## 4. 태그 (가드)
```sh
M=$(gh pr view <n> --json mergeCommit -q .mergeCommit.oid)
[ -n "$M" ] && git fetch -q origin && git tag vX.Y.Z "$M" && git push -q origin vX.Y.Z
git ls-remote origin refs/tags/vX.Y.Z   # 머지 커밋과 같은지
```
머지 커밋이 빈 값이면 태그를 달지 않는다 (v0.22.3 옛 커밋 태그 사고).

## 5. 배포 확인
- API(Railway): `railway deployment list --service api` 최신이 SUCCESS 가 될 때까지 기다린다. 마이그레이션이 있으면 `railway logs --service api --deployment | grep Applying` 으로 이름을 확인 (Dockerfile CMD 가 `prisma migrate deploy`)
- 웹(Vercel): main 머지 커밋 SHA 의 production 배포가 READY 인지 본다. 안 생겼으면 Vercel MCP `create_deployment`(target production, main SHA)로 수동 배포
- 사용자에게 바뀐 점과 함께 한국어로 보고

## 앱 (필요할 때만)
- iOS: 태그 워크트리에서 `eas build -p ios --profile production --non-interactive --no-wait` → `eas submit -p ios --id <buildId>`. App Store Connect 화면 작업은 사용자 로그인 뒤 ego-browser
- Android: `eas build -p android --profile production` → `eas submit -p android --latest`
- 스토어 제출, 결제, 약관 동의는 사용자에게 먼저 보고한다
