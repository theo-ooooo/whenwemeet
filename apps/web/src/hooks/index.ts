// 화면/컴포넌트의 데이터 접근 창구. 화면은 lib/api 와 fetch 를 직접 쓰지 않고 여기 훅만 쓴다 (agents/frontend.md)
export { messageOf, type ApiFailure } from "./_error";
export type { QueryOptions, QueryResult } from "./_useQuery";
export type { MutationOptions, MutationOutcome, MutationResult } from "./_useMutation";

// 조회
export { useMe } from "./useMe";
export { useGroups } from "./useGroups";
export { useGroup } from "./useGroup";
export { useEvents } from "./useEvents";
export { useEvent } from "./useEvent";
export { useAnniversaries } from "./useAnniversaries";
export { useFreeSlots, type FreeSlotsParams } from "./useFreeSlots";
export { useNews } from "./useNews";
export { useHealth, type Health } from "./useHealth";
export { useNotificationSettings, useUpdateNotificationSettings } from "./useNotificationSettings";

// 변경
export { useCreateEvent } from "./useCreateEvent";
export { useUpdateEvent } from "./useUpdateEvent";
export { useDeleteEvent } from "./useDeleteEvent";
export { useCreateGroup } from "./useCreateGroup";
export { useJoinGroup } from "./useJoinGroup";
export { useUpdateGroup } from "./useUpdateGroup";
export { useRotateInviteCode } from "./useRotateInviteCode";
export { useUpdateMembership } from "./useUpdateMembership";
export { useLeaveGroup } from "./useLeaveGroup";
export { useCreateAnniversary } from "./useCreateAnniversary";
export { useUpdateAnniversary } from "./useUpdateAnniversary";
export { useDeleteAnniversary } from "./useDeleteAnniversary";
export { useMarkNewsSeen } from "./useMarkNewsSeen";
export { useDeleteMe } from "./useDeleteMe";
export { useUpdateMe } from "./useUpdateMe";
export { useUploadAvatar } from "./useUploadAvatar";
export { useDeleteAvatar } from "./useDeleteAvatar";
export { useRegisterPushDevice, useRemovePushDevice, type PushDeviceInput } from "./usePushDevice";
export { useRequestEmailLogin, useVerifyEmailCode, useEmailSignup, type EmailRequestResult } from "./useEmailLogin";

// 공통 이벤트
export { useGroupGone } from "./useGroupGone";
