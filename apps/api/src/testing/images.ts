import sharp from 'sharp';

/** 테스트용 단색 이미지 (테스트 전용) */
export async function sampleImage(format: 'jpeg' | 'png' | 'webp', width = 800, height = 400): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 242, g: 109, b: 109 } } })
    .toFormat(format)
    .toBuffer();
}
