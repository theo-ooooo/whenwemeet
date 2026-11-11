import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** 가짜 Expo 서버가 받은 메시지 한 건 */
export interface ReceivedMessage {
  to: string;
  title: string;
  subtitle?: string;
  body?: string;
  data: { url: string; kind: string; nid: number };
  expiration: number;
}

export type FakeTicket = { status: 'ok'; id: string } | { status: 'error'; message: string; details: { error: string } };

/**
 * e2e 용 가짜 Expo 푸시 서버 (#188, 설계 11장). 127.0.0.1 임의 포트에서 /send 와 /getReceipts 를 흉내 낸다.
 * `ticketFor` 로 토큰별 티켓, `receipts` 로 영수증을 정한다
 */
export class FakeExpo {
  readonly messages: ReceivedMessage[] = [];
  readonly receiptRequests: string[][] = [];
  /** 토큰별 티켓. 기본은 ok + 새 id */
  ticketFor: (token: string, index: number) => FakeTicket = (_token, index) => ({ status: 'ok', id: `tk-${index}` });
  /** 영수증 id → 결과. 없으면 응답에서 뺀다 */
  receipts = new Map<string, { status: 'ok' } | { status: 'error'; details: { error: string } }>();
  private server: Server | null = null;
  private ticketSeq = 0;

  get url(): string {
    const { port } = this.server!.address() as AddressInfo;
    return `http://127.0.0.1:${port}/--/api/v2/push`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void readJson(req).then((body) => {
        if (req.url?.endsWith('/send')) {
          const messages = body as ReceivedMessage[];
          this.messages.push(...messages);
          const data = messages.map((message) => this.ticketFor(message.to, ++this.ticketSeq));
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data }));
          return;
        }
        if (req.url?.endsWith('/getReceipts')) {
          const ids = (body as { ids: string[] }).ids;
          this.receiptRequests.push(ids);
          const data = Object.fromEntries(ids.filter((id) => this.receipts.has(id)).map((id) => [id, this.receipts.get(id)]));
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data }));
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
  }

  reset(): void {
    this.messages.length = 0;
    this.receiptRequests.length = 0;
    this.receipts.clear();
    this.ticketFor = (_token, index) => ({ status: 'ok', id: `tk-${index}` });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
}
