import type { ModelResult } from './assistant-model.js';
import { checkArgs, isToolName, TOOL_SCHEMAS, type Schema, type ToolName } from './tools.js';

/**
 * (#450) 모델 결과 → 처리할 일 (설계 AI-비서.md 5장 서버 가드, D-267). 순수 함수.
 * 모델이 쓴 글자(text)는 어떤 경우에도 결과에 싣지 않는다. 화면 글자는 replies.ts 의 서버 문구 틀만
 */
export type GuardOutcome =
  | { kind: 'refusal' }
  | { kind: 'greet' }
  | { kind: 'invalid' }
  | { kind: 'tool'; name: Exclude<ToolName, 'refuse' | 'greet'>; args: Record<string, unknown> };

export function decide(result: ModelResult): GuardOutcome {
  // 도구 없이 글로만 답함, 빈 답, 길이 초과로 잘림, 내용 필터 → 거절
  if (result.finishReason === 'length' || result.finishReason === 'content_filter') return { kind: 'refusal' };
  const call = result.toolCalls[0];
  if (!call) return { kind: 'refusal' };
  // 첫 번째 도구 호출만 본다 (parallel_tool_calls false 인데도 여럿 오면)
  if (!isToolName(call.name)) return { kind: 'invalid' };
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    return { kind: 'invalid' };
  }
  if (!checkArgs(TOOL_SCHEMAS[call.name].parameters as Schema, args)) return { kind: 'invalid' };
  if (call.name === 'refuse') return { kind: 'refusal' };
  if (call.name === 'greet') return { kind: 'greet' };
  return { kind: 'tool', name: call.name, args: args as Record<string, unknown> };
}
