import { redirect } from "next/navigation";

// (#515) /admin 은 첫 탭(공지사항)으로
export default function AdminHome() {
  redirect("/admin/notices");
}
