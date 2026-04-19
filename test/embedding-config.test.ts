import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { resolveEmbeddingConfig } from '../src/core/embedding.ts';
import type { GBrainConfig } from '../src/core/config.ts';

describe('resolveEmbeddingConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env vars before each test
    process.env = { ...originalEnv };
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_DIMENSIONS;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('returns default OpenAI config when no env vars or config set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';

    const config = resolveEmbeddingConfig();

    expect(config.model).toBe('text-embedding-3-large');
    expect(config.dimensions).toBe(1536);
    expect(config.baseURL).toBeUndefined();
    expect(config.isCustomBaseUrl).toBe(false);
    expect(config.apiKey).toBe('sk-test');
  });

  test('uses local server config when EMBEDDING_BASE_URL is set', () => {
    process.env.EMBEDDING_BASE_URL = 'http://192.168.1.217:8081/v1';

    const config = resolveEmbeddingConfig();

    expect(config.baseURL).toBe('http://192.168.1.217:8081/v1');
    expect(config.isCustomBaseUrl).toBe(true);
    expect(config.apiKey).toBe('***'); // Dummy key for local servers
  });

  test('env vars override config file values', () => {
    process.env.EMBEDDING_MODEL = 'mlx-community/mxbai-embed-large-v1-fp16';
    process.env.EMBEDDING_DIMENSIONS = '1024';

    const fileConfig: GBrainConfig = {
      engine: 'pglite',
      embedding_model: 'different-model',
      embedding_dimensions: 768,
    };

    // Mock loadConfig by setting env vars (which take precedence)
    const config = resolveEmbeddingConfig();

    expect(config.model).toBe('mlx-community/mxbai-embed-large-v1-fp16');
    expect(config.dimensions).toBe(1024);
  });

  test('parses dimensions from string env var', () => {
    process.env.EMBEDDING_DIMENSIONS = '768';

    const config = resolveEmbeddingConfig();

    expect(config.dimensions).toBe(768);
  });

  test('uses dummy API key for local servers without real key', () => {
    process.env.EMBEDDING_BASE_URL = 'http://localhost:11434/v1';
    // No OPENAI_API_KEY set

    const config = resolveEmbeddingConfig();

    expect(config.apiKey).toBe('***');
  });

  test('uses real API key when available even with local config', () => {
    process.env.EMBEDDING_BASE_URL = 'http://localhost:11434/v1';
    process.env.OPENAI_API_KEY = 'sk-real-key';

    const config = resolveEmbeddingConfig();

    // Should use real key if available (some local servers might validate)
    expect(config.apiKey).toBe('sk-real-key');
  });

  test('trims whitespace from config values', () => {
    process.env.EMBEDDING_BASE_URL = '  http://192.168.1.217:8081/v1  ';
    process.env.EMBEDDING_MODEL = '  custom-model  ';

    const config = resolveEmbeddingConfig();

    expect(config.baseURL).toBe('http://192.168.1.217:8081/v1');
    expect(config.model).toBe('custom-model');
  });

  test('defaults dimensions to 1536 when env var is invalid', () => {
    process.env.EMBEDDING_DIMENSIONS = 'invalid';

    const config = resolveEmbeddingConfig();

    expect(config.dimensions).toBe(1536);
  });
});
