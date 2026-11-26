import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** 가짜 네이버 서버가 받은 요청 하나 */
export interface NaverRequest {
  query: Record<string, string>;
  id: string | undefined;
  secret: string | undefined;
}

/** 실제 응답 모양 (2026-11-13 "서울숲" 검색 앞 두 항목) */
const ITEMS = [
  {
    title: '<b>서울숲</b>',
    link: '',
    category: '여행,명소>숲,숲길',
    description: '',
    telephone: '',
    address: '서울특별시 성동구 성수동1가 678-1',
    roadAddress: '서울특별시 성동구 뚝섬로 273',
    mapx: '1270385663',
    mapy: '375419644',
  },
  {
    title: '서울바쿠테 성수본점 국밥&amp;쌀국수',
    link: '',
    category: '음식점>아시아음식',
    description: '',
    telephone: '',
    address: '서울특별시 성동구 성수동1가 685-20',
    roadAddress: '서울특별시 성동구 왕십리로8길 8 1층 101호',
    mapx: '1270457108',
    mapy: '375463497',
  },
];

/**
 * e2e 용 가짜 NAVER API HUB 지역 검색 서버 (D-259). 127.0.0.1 임의 포트에서 `/search/v1/local` 을 흉내 낸다.
 * 검색어에 "서울숲" 이 들어 있으면 ITEMS, 아니면 빈 목록. status 로 실패를 흉내 낸다
 */
export class FakeNaver {
  readonly requests: NaverRequest[] = [];
  status = 200;
  private server: Server | null = null;

  get url(): string {
    const { port } = this.server!.address() as AddressInfo;
    return `http://127.0.0.1:${port}/search/v1/local`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const header = (name: string) => {
        const v = req.headers[name];
        return Array.isArray(v) ? v[0] : v;
      };
      this.requests.push({
        query: Object.fromEntries(url.searchParams),
        id: header('x-ncp-apigw-api-key-id'),
        secret: header('x-ncp-apigw-api-key'),
      });
      res.setHeader('content-type', 'application/json');
      if (this.status !== 200) {
        res.statusCode = this.status;
        res.end(JSON.stringify({ errorMessage: 'limit', errorCode: '012' }));
        return;
      }
      const items = (url.searchParams.get('query') ?? '').includes('서울숲')
        ? ITEMS
        : [];
      res.end(
        JSON.stringify({
          lastBuildDate: new Date().toUTCString(),
          total: items.length,
          start: 1,
          display: items.length,
          items,
        }),
      );
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(0, '127.0.0.1', resolve),
    );
  }

  async stop(): Promise<void> {
    await new Promise<void>(
      (resolve) => this.server?.close(() => resolve()) ?? resolve(),
    );
  }
}
