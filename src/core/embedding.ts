/**
 * Embedding Service
 * Ported from production Ruby implementation (embedding_service.rb, 190 LOC)
 *
 * Supports HTTP provider (local MLX, Ollama, etc.) via GBRAIN_EMBED_HTTP_URL
 * Fallback: OpenAI text-embedding-3-large at 1536 dimensions.
 * Retry with exponential backoff (4s base, 120s cap, 5 retries).
 * 8000 character input truncation.
 */

import OpenAI from 'openai';

// HTTP provider configuration (env-based, zero breaking changes)
const HTTP_URL = process.env.GBRAIN_EMBED_HTTP_URL;
const HTTP_MODEL = process.env.GBRAIN_EMBED_HTTP_MODEL || 'text-embedding-3-large';
const HTTP_DIMS = parseInt(process.env.GBRAIN_EMBED_HTTP_DIMS || '0', 10) || null;

const MODEL = 'text-embedding-3-large';
const DIMENSIONS = 1536;
const MAX_CHARS = 8000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 4000;
const MAX_DELAY_MS = 120000;
const BATCH_SIZE = 100;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI();
  }
  return client;
}

export async function embed(text: string): Promise<Float32Array> {
  const truncated = text.slice(0, MAX_CHARS);
  const result = await embedBatch([truncated]);
  return result[0];
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  // Use HTTP provider if configured (local MLX, Ollama, etc.)
  if (HTTP_URL) {
    return embedBatchHttp(texts);
  }

  const truncated = texts.map(t => t.slice(0, MAX_CHARS));
  const results: Float32Array[] = [];

  // Process in batches of BATCH_SIZE
  for (let i = 0; i < truncated.length; i += BATCH_SIZE) {
    const batch = truncated.slice(i, i + BATCH_SIZE);
    const batchResults = await embedBatchWithRetry(batch);
    results.push(...batchResults);
  }

  return results;
}

// HTTP provider for local MLX embeddings (OpenAI-compatible API)
async function embedBatchHttp(texts: string[]): Promise<Float32Array[]> {
  const truncated = texts.map(t => t.slice(0, MAX_CHARS));
  const results: Float32Array[] = [];

  // Process in batches
  for (let i = 0; i < truncated.length; i += BATCH_SIZE) {
    const batch = truncated.slice(i, i + BATCH_SIZE);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${HTTP_URL}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: HTTP_MODEL,
            input: batch,
            ...(HTTP_DIMS ? { dimensions: HTTP_DIMS } : {}),
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP embedding failed (${response.status}): ${errorText}`);
        }

        const data = await response.json() as any;

        // Handle OpenAI-compatible response format
        if (data.data && Array.isArray(data.data)) {
          const sorted = data.data.sort((a: any, b: any) => (a.index || 0) - (b.index || 0));
          results.push(...sorted.map((d: any) => new Float32Array(d.embedding)));
        } else if (Array.isArray(data.embeddings)) {
          // Some local servers return { embeddings: [...] }
          results.push(...data.embeddings.map((e: number[]) => new Float32Array(e)));
        } else if (Array.isArray(data)) {
          // Direct array response
          results.push(...data.map((e: number[]) => new Float32Array(e)));
        } else {
          throw new Error(`Unexpected HTTP embedding response format: ${JSON.stringify(data).slice(0, 200)}`);
        }

        break; // Success, exit retry loop
      } catch (e: unknown) {
        if (attempt === MAX_RETRIES - 1) throw e;
        const delay = exponentialDelay(attempt);
        await sleep(delay);
      }
    }
  }

  return results;
}

async function embedBatchWithRetry(texts: string[]): Promise<Float32Array[]> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await getClient().embeddings.create({
        model: MODEL,
        input: texts,
        dimensions: DIMENSIONS,
      });

      // Sort by index to maintain order
      const sorted = response.data.sort((a, b) => a.index - b.index);
      return sorted.map(d => new Float32Array(d.embedding));
    } catch (e: unknown) {
      if (attempt === MAX_RETRIES - 1) throw e;

      // Check for rate limit with Retry-After header
      let delay = exponentialDelay(attempt);

      if (e instanceof OpenAI.APIError && e.status === 429) {
        const retryAfter = e.headers?.['retry-after'];
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed)) {
            delay = parsed * 1000;
          }
        }
      }

      await sleep(delay);
    }
  }

  // Should not reach here
  throw new Error('Embedding failed after all retries');
}

function exponentialDelay(attempt: number): number {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { MODEL as EMBEDDING_MODEL, DIMENSIONS as EMBEDDING_DIMENSIONS };
