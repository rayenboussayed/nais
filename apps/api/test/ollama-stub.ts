import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubBehavior {
  /** Status to answer with; defaults to 200. Use 500 to exercise upstream failures. */
  status?: number;
  /** Milliseconds to wait before answering; used to exercise client timeouts. */
  delayMs?: number;
  /** Completion text returned on 200; defaults to `[fr] bonjour`. */
  completion?: string;
}

export interface OllamaStub {
  url: string;
  hitCount(): number;
  close(): Promise<void>;
  setBehavior(behavior: StubBehavior): void;
}

/**
 * Minimal stand-in for Ollama's OpenAI-compatible endpoint:
 * `POST {base}/v1/chat/completions` → a canned chat completion. Implemented
 * against the real HTTP surface so the production code path (SDK, retries,
 * timeouts, usage accounting) is exercised end to end without a GPU.
 */
export async function startOllamaStub(initial: StubBehavior = {}): Promise<OllamaStub> {
  let behavior: StubBehavior = { status: 200, completion: '[fr] bonjour', ...initial };
  let hits = 0;

  const server: Server = createServer((req, res) => {
    hits += 1;

    req.on('data', () => {
      /* drain the request body so the socket closes cleanly */
    });
    req.on('end', () => {
      const answer = () => {
        if (behavior.status && behavior.status !== 200) {
          res.writeHead(behavior.status, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ error: { message: 'stubbed upstream failure', type: 'api_error' } }),
          );
          return;
        }
        const completion = behavior.completion ?? '[fr] bonjour';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl-stub',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'bonsai-2:2b',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: completion },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
          }),
        );
      };

      if (behavior.delayMs) {
        setTimeout(answer, behavior.delayMs);
      } else {
        answer();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    hitCount: () => hits,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    setBehavior(next) {
      behavior = { ...behavior, ...next };
    },
  };
}
