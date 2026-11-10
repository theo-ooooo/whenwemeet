"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 프로필 사진 업로드 POST /me/avatar (multipart 필드 file). 축소는 부르는 쪽이 lib/image 로 먼저 한다 */
export function useUploadAvatar(opts?: MutationOptions) {
  const fn = useCallback((file: Blob) => {
    const form = new FormData();
    form.append("file", file, file instanceof File ? file.name : "avatar.jpg");
    return api<{ profileImageUrl: string }>("/me/avatar", { method: "POST", form });
  }, []);
  return useMutation(fn, opts);
}
