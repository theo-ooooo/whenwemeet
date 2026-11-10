"use client";
import type { Me } from "@/lib/types";
import { useQuery, type QueryOptions } from "./_useQuery";

/** 내 정보 GET /me */
export function useMe(opts?: QueryOptions<Me>) {
  return useQuery<Me>("/me", opts);
}
