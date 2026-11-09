"use client";
// 업로드 전 사진 축소 (화면흐름 10). 서버가 다시 512 webp 로 만들지만, 폰 원본(수 MB)을 그대로 올리지 않도록
// 긴 변을 1024px 이하로 줄여 JPEG 로 다시 굽는다. EXIF(위치 등) 도 이때 빠진다.

export const AVATAR_UPLOAD_MAX_EDGE = 1024;

/**
 * 브라우저가 디코딩할 수 있으면 축소한 JPEG Blob, 못 하면(예: 크롬의 HEIC) 원본을 그대로 돌려준다.
 * 원본이 서버에서도 못 읽는 형식이면 서버가 400 으로 알려 준다
 */
export async function shrinkImage(file: File, maxEdge = AVATAR_UPLOAD_MAX_EDGE): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // 투명 PNG 는 JPEG 에서 검게 나오지 않도록 흰 바탕을 깐다
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob ?? file;
  } finally {
    bitmap.close();
  }
}
