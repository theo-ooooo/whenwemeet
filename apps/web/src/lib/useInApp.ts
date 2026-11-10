"use client";
// 앱 셸 안인지 (lib/app-bridge.ts isInApp). 서버 렌더와 하이드레이션 중에는 serverGuess(UA 판정)를 쓰고,
// 브라우저에서 window.ReactNativeWebView 까지 확인한 값으로 바뀐다. 판정이 틀리면 웹 화면으로 떨어진다
import { useSyncExternalStore } from "react";
import { isInApp } from "./app-bridge";

const noop = () => () => {};

export function useInApp(serverGuess = false): boolean {
  return useSyncExternalStore(noop, isInApp, () => serverGuess);
}
