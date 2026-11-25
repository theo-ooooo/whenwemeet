// @vitest-environment happy-dom
// (#544) 공지 상세를 열면: 로그인했을 때만 읽음 기록(경로 via), ?from= 은 주소에서 지운다, 띠는 감춘다 (D-293)
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markRead = vi.fn();
const dismissHint = vi.fn();
vi.mock("@/hooks", () => ({ useMarkNoticeRead: () => ({ mutate: markRead, isPending: false, error: null }) }));
vi.mock("@/lib/hint", () => ({ dismissHint: (key: string) => dismissHint(key) }));

const { NoticeReadMark } = await import("../NoticeReadMark");

describe("NoticeReadMark (#544)", () => {
  beforeEach(() => {
    markRead.mockReset().mockResolvedValue({ ok: true });
    dismissHint.mockReset();
    window.history.replaceState(null, "", "/notices/5?from=push");
  });
  afterEach(cleanup);

  it("로그인했으면 경로와 같이 한 번 기록하고 ?from= 을 지운다", () => {
    const { rerender } = render(<NoticeReadMark id={5} via="push" loggedIn stripFrom />);
    rerender(<NoticeReadMark id={5} via="push" loggedIn stripFrom />);
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith({ id: 5, via: "push" });
    expect(window.location.pathname + window.location.search).toBe("/notices/5");
    expect(dismissHint).toHaveBeenCalledWith("notice.5");
  });

  it("로그인하지 않았으면 기록하지 않는다 (주소는 지운다)", () => {
    render(<NoticeReadMark id={5} via="push" loggedIn={false} stripFrom />);
    expect(markRead).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  it("?from= 이 없으면 주소를 건드리지 않는다", () => {
    window.history.replaceState(null, "", "/notices/5?utm=x");
    render(<NoticeReadMark id={5} via="detail" loggedIn stripFrom={false} />);
    expect(markRead).toHaveBeenCalledWith({ id: 5, via: "detail" });
    expect(window.location.search).toBe("?utm=x");
  });
});
