---
name: wwm-mock-qa
description: 언제볼까 웹 화면 변경을 실제로 띄워 확인하는 방법. API 없이 API_MOCK 개발 서버와 ego-browser 로 폰, 폴드, PC 폭과 라이트, 다크 스크린샷을 찍는다. 화면이나 레이아웃을 바꾼 뒤 "직접 확인", prove-it-works 단계에서 쓴다.
---

# mock 화면 확인

1. 개발 서버: `cd <워크트리>/apps/web && API_MOCK=1 npx next dev -p <빈 포트>`. 수정이 안 보이면 HMR 이 멈춘 것이니 서버를 다시 띄운다
2. 로그인: `<B>/auth/kakao?next=<경로>` 로 들어가면 mock 계정으로 들어간다 (7~8초 기다림)
3. ego-browser 스크립트는 `ego-browser nodejs < script.js` 로 돌린다. **경로를 process.argv 로 넘기지 말 것** (헬퍼 실행 파일을 덮어쓴 사고). 경로는 스크립트 안에 적는다
   ```js
   const task = await taskSpace("이름");
   const page = task.page("p1");
   await page.cdp("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true});
   await page.goto(B+"/auth/kakao?next=/"); await page.waitForTimeout(8000);
   await page.screenshot({path:"<스크래치>/a.png"});
   await task.finish({keep:[]});
   ```
4. 폭: 레이아웃을 건드렸으면 360, 390, 600(폴드 펼침), 800, 1280, 1440 과 라이트/다크를 찍는다. 앱 셸 흉내는 `Page.addScriptToEvaluateOnNewDocument` + `Emulation.setUserAgentOverride`(UA 끝 `WhenwemeetApp/<버전> (ios|android)`)
5. 찍은 이미지는 직접 열어 겹침, 잘림, 대비를 본다. 스크린샷은 커밋하지 않는다
6. 끝나면 개발 서버를 끈다
