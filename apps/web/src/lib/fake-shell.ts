// (#549) 목 모드(API_MOCK=1) 전용 가짜 앱 셸. 브라우저에서 앱 셸 화면(휴대폰 캘린더 설정)을 눌러 보려고 쓴다.
// app/layout.tsx 가 목 모드일 때만 <head> 에 넣는다 (운영 번들에는 이 문자열만 있고 실행되지 않음).
// 켜기: 주소에 ?fakeShell=1 (이 탭 세션 동안 유지), 끄기 ?fakeShell=0. 권한 거부 흉내: ?fakeCalendar=deny
// 하는 일: UA 끝에 `WhenwemeetApp/1.3.0 (ios) … DeviceCalendar/1` 를 붙이고 window.ReactNativeWebView 를 둔다.
// 휴대폰 캘린더 메시지에만 셸처럼 wwm:app calendarStatus 로 답한다(상태는 sessionStorage). 다른 메시지는 콘솔에만 찍는다.
// 받은 메시지 요약은 window.__fakeShellLog 에 쌓인다 (브라우저 점검 스크립트가 읽는다)
export const FAKE_SHELL_KEY = "wwm.fake-shell";

export const FAKE_SHELL_SCRIPT = `(function(){try{
var K="${FAKE_SHELL_KEY}",SK=K+".calendar",q=new URLSearchParams(location.search);
if(q.get("fakeShell")==="1")sessionStorage.setItem(K,"1");
if(q.get("fakeShell")==="0")sessionStorage.removeItem(K);
if(q.get("fakeCalendar")==="deny")sessionStorage.setItem(K+".deny","1");
if(sessionStorage.getItem(K)!=="1")return;
var ua=navigator.userAgent+" WhenwemeetApp/1.3.0 (ios) EmailLogin/1 Widget/1 DeviceCalendar/1";
Object.defineProperty(navigator,"userAgent",{get:function(){return ua},configurable:true});
function st(){try{var s=JSON.parse(sessionStorage.getItem(SK)||"null");if(s)return s}catch(e){}return{permission:"undetermined",enabled:false,lastSyncedAt:null,count:0}}
function sv(s){sessionStorage.setItem(SK,JSON.stringify(s))}
function reply(id,s){setTimeout(function(){window.dispatchEvent(new CustomEvent("wwm:app",{detail:{v:1,type:"calendarStatus",id:id,permission:s.permission,canAskAgain:s.permission!=="denied",enabled:s.enabled,lastSyncedAt:s.lastSyncedAt,count:s.count,failed:false}}))},250)}
window.__fakeShellLog=[];
window.ReactNativeWebView={postMessage:function(data){var m=JSON.parse(data),s=st();
window.__fakeShellLog.push({type:m.type,length:data.length,events:m.snapshot&&m.snapshot.events?m.snapshot.events.length:null,at:Date.now()});
console.info("[fake-shell]",m.type,m);
if(m.type==="calendarSyncStatus")reply(m.id,s);
else if(m.type==="calendarSyncEnable"){if(sessionStorage.getItem(K+".deny")==="1"){s.permission="denied";s.enabled=false}else{s.permission="granted";s.enabled=true}sv(s);reply(m.id,s)}
else if(m.type==="calendarSyncDisable"){s.enabled=false;s.count=0;s.lastSyncedAt=null;sv(s);reply(m.id,s)}
else if(m.type==="calendarSync"){if(s.enabled){s.count=m.snapshot.events.length;s.lastSyncedAt=new Date().toISOString();sv(s);window.__fakeShellLastSnapshot=m.snapshot}if(m.id)reply(m.id,s)}
}};
}catch(e){}})()`;
