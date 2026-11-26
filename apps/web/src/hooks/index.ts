// 화면/컴포넌트의 데이터 접근 창구. 화면은 lib/api 와 fetch 를 직접 쓰지 않고 여기 훅만 쓴다 (agents/frontend.md)
export { messageOf, type ApiFailure } from "./_error";
export type { QueryOptions, QueryResult } from "./_useQuery";
export type { MutationOptions, MutationOutcome, MutationResult } from "./_useMutation";

// 조회
export { useMe } from "./useMe";
export { useAuthAccounts, useRequestLinkEmail, useLinkEmail, useCheckAppLink, useLinkAppAccount, useUnlinkAccount } from "./useAuthAccounts";
export { useGroups } from "./useGroups";
export { useGroup } from "./useGroup";
export { useEvents } from "./useEvents";
export { useEvent } from "./useEvent";
export { useAnniversaries } from "./useAnniversaries";
export { useBirthdays } from "./useBirthdays";
export { useAnniversaryItems } from "./useAnniversaryItems";
export { useFreeSlots, type FreeSlotsParams } from "./useFreeSlots";
export { useNews } from "./useNews";
export { useHealth, type Health } from "./useHealth";
export { useNotificationSettings, useUpdateNotificationSettings } from "./useNotificationSettings";
export { useWidgetAgenda } from "./useWidgetAgenda";
export { useDeviceCalendarSource } from "./useDeviceCalendarSource";
export { useTodoLists, useTodoList, useRefetchOnVisible } from "./useTodos";
export { useTodoListEditor, isPendingItem } from "./useTodoListEditor";
export { useEventDraft } from "./useEventDraft";
export { useCalendarFeed } from "./useCalendarFeed";
export { usePolls, usePoll } from "./usePolls";
export { usePlaceSearch } from "./usePlaceSearch";
export { usePlaceResolve } from "./usePlaceResolve";
export { useEventSearch } from "./useEventSearch";
export { useNotices, type NoticeInput } from "./useNotices";
export {
  useAdminNotices,
  useAdminNotice,
  useAdminUsers,
  useAdminUser,
  useAdminLogs,
  useAdminGroups,
  useAdminGroup,
  useAdminEvents,
  useAdminEvent,
  useAdminReports,
  useAdminReportTarget,
  useAdminReportOpenCount,
  useAdminStats,
  useAdminNoticeStats,
  useAdminNoticeReaders,
} from "./useAdmin";
export type { PagedResult } from "./_usePaged";

// 변경
export { useCreateEvent } from "./useCreateEvent";
export { useUpdateEvent } from "./useUpdateEvent";
export { useDeleteEvent } from "./useDeleteEvent";
export { useRestoreEvent } from "./useRestoreEvent";
export { useSetRsvp, useSetReaction } from "./useEventResponses";
export { useCreateGroup } from "./useCreateGroup";
export { useJoinGroup } from "./useJoinGroup";
export { useCreateEventShare, useRevokeEventShare, useJoinEventShare } from "./useEventShare";
export { useUpdateGroup } from "./useUpdateGroup";
export { useRotateInviteCode } from "./useRotateInviteCode";
export { useSaveCalendarFeed, useRotateCalendarFeed, useDeleteCalendarFeed, type CalendarFeedSettings } from "./useCalendarFeed";
export { useUpdateMembership } from "./useUpdateMembership";
export { useLeaveGroup } from "./useLeaveGroup";
export { useCreateAnniversary } from "./useCreateAnniversary";
export { useUpdateAnniversary } from "./useUpdateAnniversary";
export { useDeleteAnniversary } from "./useDeleteAnniversary";
export {
  useCreateTodoList,
  useRenameTodoList,
  useDeleteTodoList,
  useCreateTodoItem,
  useUpdateTodoItem,
  useDeleteTodoItem,
  useClearDoneTodoItems,
} from "./useTodos";
export { useCreatePoll, useVotePoll, useConfirmPoll, useDeletePoll } from "./usePolls";
export { useMarkNewsSeen } from "./useMarkNewsSeen";
export { useDismissNotice, useMarkNoticeRead, useMarkNoticesSeen, useNoticeAttention } from "./useNotices";
// (#539) 앱 업데이트 안내
export { useAdminAppReleases, useAppRelease, useUpdateAppRelease, type AppReleaseInput } from "./useAppRelease";
export {
  useCreateNotice,
  useUpdateNotice,
  useDeleteNotice,
  useUpdateUserRole,
  useHideTarget,
  useUnhideTarget,
  useDeleteTarget,
  useCloseReport,
} from "./useAdmin";
export { useCreateReport, type ReportInput } from "./useReports";
export { useSendAssistantMessage, useAssistantConsent } from "./useAssistant";
export { useDeleteMe } from "./useDeleteMe";
export { useUpdateMe } from "./useUpdateMe";
export { useUpdateStartCalendar } from "./useUpdateStartCalendar";
export { useUpdateBirthday } from "./useUpdateBirthday";
export { useUpdateLunarDisplay } from "./useUpdateLunarDisplay";
export { useUploadAvatar } from "./useUploadAvatar";
export { useDeleteAvatar } from "./useDeleteAvatar";
export { useImportEvents, usePreviewImport, type ImportInput } from "./useImportEvents";
export { useRegisterPushDevice, useRemovePushDevice, type PushDeviceInput } from "./usePushDevice";
export { useRequestEmailLogin, useVerifyEmailCode, useEmailSignup, type EmailRequestResult } from "./useEmailLogin";

// 공통 이벤트
export { useGroupGone, useGroupHidden } from "./useGroupGone";
