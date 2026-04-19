/**
 * Embedding Service
 * Ported from production Ruby implementation (embedding_service.rb, 190 LOC)
 *
 * Supports local embedding servers (MLX, Ollama, etc.) via config/env:
 *   - EMBEDDING_BASE_URL - Custom endpoint (e.g., http://192.168.1.217:8081/v1)
 *   - EMBEDDING_MODEL - Model name (default: text-embedding-3-large)
 *   - EMBEDDING_DIMENSIONS - Vector dimensions (default: 1536)
 *
 * OpenAI SDK is used for both local and cloud providers.
 * Retry with exponential backoff (4s base, 120s cap, 5 retries).
 * 8000 character input truncation.
 */

import OpenAI from 'openai';
import { loadConfig } from './config.ts';

const DEFAULT_MODEL = 'text-embedding-3-large';
const DEFAULT_DIMENSIONS = 1536;
const MAX_CHARS = 8000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 4000;
const MAX_DELAY_MS = 120000;
const BATCH_SIZE = 100;
const LOCAL_API_KEY_FALLBACK = '***'; // Local servers don't validate keys

let client: OpenAI | null = null;
let clientCacheKey: string | null = null;

export interface ResolvedEmbeddingConfig {
  apiKey: string;
  baseURL: string | undefined;
  model: string;
  dimensions: number;
  isCustomBaseUrl: boolean;
}

function resolveConfig(): ResolvedEmbeddingConfig {
  const brainConfig = loadConfig();

  // Config precedence: env vars > config file > defaults
  const baseURL = process.env.EMBEDDING_BASE_URL?.trim()
    || brainConfig?.embedding_base_url?.trim()
    || undefined;

  const model = process.env.EMBEDDING_MODEL?.trim()
    || brainConfig?.embedding_model?.trim()
    || DEFAULT_MODEL;

  const dimensions = parseInt(
    process.env.EMBEDDING_DIMENSIONS
    || brainConfig?.embedding_dimensions?.toString()
    || String(DEFAULT_DIMENSIONS),
    10
  ) || DEFAULT_DIMENSIONS;

  const isCustomBaseUrl = !!baseURL;

  // Use dummy key for local servers, real key for OpenAI
  const apiKey = brainConfig?.openai_api_key?.trim()
    || process.env.OPENAI_API_KEY?.trim()
    || (isCustomBaseUrl ? LOCAL_API_KEY_FALLBACK : '');

  return {
    apiKey,
    baseURL,
    model,
    dimensions,
    isCustomBaseUrl,
  };
}

function getClient(config: ResolvedEmbeddingConfig): OpenAI {
  const cacheKey = JSON.stringify({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });

  if (!client || clientCacheKey !== cacheKey) {
    client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    clientCacheKey = cacheKey;
  }
  return client;
}

export async function embed(text: string): Promise<Float32Array> {
  const truncated = text.slice(0, MAX_CHARS);
  const result = await embedBatch([truncated]);
  return result[0];
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const config = resolveConfig();
  const truncated = texts.map(t => t.slice(0, MAX_CHARS));
  const results: Float32Array[] = [];

  // Process in batches of BATCH_SIZE
  for (let i = 0; i < truncated.length; i += BATCH_SIZE) {
    const batch = truncated.slice(i, i + BATCH_SIZE);
    const batchResults = await embedBatchWithRetry(batch, config);
    results.push(...batchResults);
  }

  return results;
}

async function embedBatchWithRetry(
  texts: string[],
  config: ResolvedEmbeddingConfig
): Promise<Float32Array[]> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Build request - omit dimensions for custom servers (they have fixed widths)
      const request: { model: string; input: string[]; dimensions?: number } = {
        model: config.model,
        input: texts,
      };
      if (!config.isCustomBaseUrl) {
        request.dimensions = config.dimensions;
      }

      const response = await getClient(config).embeddings.create(request);

      // Sort by index to maintain order
      const sorted = response.data.sort((a, b) => a.index - b.index);
      return sorted.map(d => new Float32Array(d.embedding));
    } catch (e: unknown) {
      if (attempt === MAX_RETRIES - 1) throw e;

      let delay = exponentialDelay(attempt);

      // Check for rate limit with Retry-After header (OpenAI-specific)
      if (e instanceof OpenAI.APIError && e.status === 429) {
        const retryAfter = e.headers?.['retry-after'];
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed)) delay = parsed * 1000;
        }
      }

      await sleep(delay);
    }
  }

  throw new Error('Embedding failed after all retries');
}

function exponentialDelay(attempt: number): number {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Exports for consumers
export {
  DEFAULT_MODEL as EMBEDDING_MODEL,
  DEFAULT_DIMENSIONS as EMBEDDING_DIMENSIONS,
  resolveConfig as resolveEmbeddingConfig,
};
