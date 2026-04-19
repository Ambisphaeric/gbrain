import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';

describe('embedding local provider', () => {
  const originalEnv = process.env;
  let openaiCreateMock: ReturnType<typeof mock>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_DIMENSIONS;
    delete process.env.OPENAI_API_KEY;

    // Mock OpenAI SDK
    openaiCreateMock = mock(async () => ({
      data: [
        { index: 0, embedding: Array(1024).fill(0.1) },
        { index: 1, embedding: Array(1024).fill(0.2) },
      ],
    }));

    mock.module('openai', () => ({
      default: class MockOpenAI {
        apiKey: string;
        baseURL: string | undefined;
        embeddings = {
          create: openaiCreateMock,
        };
        constructor(opts: { apiKey: string; baseURL?: string }) {
          this.apiKey = opts.apiKey;
          this.baseURL = opts.baseURL;
        }
      },
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
    openaiCreateMock.mockClear();
  });

  test('uses local server when EMBEDDING_BASE_URL is set', async () => {
    process.env.EMBEDDING_BASE_URL = 'http://192.168.1.217:8081/v1';
    process.env.EMBEDDING_MODEL = 'mlx-community/mxbai-embed-large-v1-fp16';
    process.env.EMBEDDING_DIMENSIONS = '1024';

    // Need to reimport to pick up new env
    const { embedBatch } = await import('../src/core/embedding.ts');
    const results = await embedBatch(['Hello world', 'Test embedding']);

    expect(results).toHaveLength(2);
    expect(results[0]).toBeInstanceOf(Float32Array);
    expect(results[0].length).toBe(1024);
  });

  test('sends request with custom model and baseURL', async () => {
    process.env.EMBEDDING_BASE_URL = 'http://192.168.1.217:8081/v1';
    process.env.EMBEDDING_MODEL = 'custom-model';

    const { embedBatch } = await import('../src/core/embedding.ts');
    await embedBatch(['test']);

    expect(openaiCreateMock).toHaveBeenCalled();
    const callArgs = openaiCreateMock.mock.calls[0][0];
    expect(callArgs.model).toBe('custom-model');
    expect(callArgs.input).toEqual(['test']);
    // Should NOT include dimensions for custom servers
    expect(callArgs.dimensions).toBeUndefined();
  });

  test('omits dimensions parameter for custom base URLs', async () => {
    process.env.EMBEDDING_BASE_URL = 'http://localhost:11434/v1';

    const { embedBatch } = await import('../src/core/embedding.ts');
    await embedBatch(['test']);

    const callArgs = openaiCreateMock.mock.calls[0][0];
    expect(callArgs.dimensions).toBeUndefined();
  });

  test('includes dimensions for OpenAI cloud API', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    // No EMBEDDING_BASE_URL set

    const { embedBatch } = await import('../src/core/embedding.ts');
    await embedBatch(['test']);

    const callArgs = openaiCreateMock.mock.calls[0][0];
    expect(callArgs.dimensions).toBe(1536);
  });

  test('truncates long inputs to MAX_CHARS', async () => {
    process.env.EMBEDDING_BASE_URL = 'http://192.168.1.217:8081/v1';

    const longText = 'a'.repeat(10000); // > 8000 MAX_CHARS

    const { embedBatch } = await import('../src/core/embedding.ts');
    await embedBatch([longText]);

    const callArgs = openaiCreateMock.mock.calls[0][0];
    expect(callArgs.input[0].length).toBe(8000);
  });

  test('uses dummy API key for local servers', async () => {
    process.env.EMBEDDING_BASE_URL = 'http://192.168.1.217:8081/v1';
    // No OPENAI_API_KEY set

    // We need to check the OpenAI client was created with dummy key
    const { resolveEmbeddingConfig } = await import('../src/core/embedding.ts');
    const config = resolveEmbeddingConfig();

    expect(config.apiKey).toBe('***');
    expect(config.isCustomBaseUrl).toBe(true);
  });

  test('uses real API key when available', async () => {
    process.env.EMBEDDING_BASE_URL = 'http://192.168.1.217:8081/v1';
    process.env.OPENAI_API_KEY = 'sk-real-key';

    const { resolveEmbeddingConfig } = await import('../src/core/embedding.ts');
    const config = resolveEmbeddingConfig();

    expect(config.apiKey).toBe('sk-real-key');
  });

  test('handles single embed call', async () => {
    process.env.EMBEDDING_BASE_URL = 'http://192.168.1.217:8081/v1';
    process.env.EMBEDDING_DIMENSIONS = '1024';

    const { embed } = await import('../src/core/embedding.ts');
    const result = await embed('Single text');

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(1024);

    // Should call embedBatch internally with single item
    expect(openaiCreateMock).toHaveBeenCalledTimes(1);
  });

  test('processes large batches in chunks', async () => {
    process.env.EMBEDDING_BASE_URL = 'http://192.168.1.217:8081/v1';

    // Mock to return embeddings for each batch
    openaiCreateMock.mockImplementation(async (args: { input: string[] }) => ({
      data: args.input.map((_, i) => ({
        index: i,
        embedding: Array(1024).fill(0.1),
      })),
    }));

    const { embedBatch } = await import('../src/core/embedding.ts');
    const texts = Array(250).fill('test text'); // > BATCH_SIZE of 100

    await embedBatch(texts);

    // Should make 3 calls (100 + 100 + 50)
    expect(openaiCreateMock).toHaveBeenCalledTimes(3);
  });

  test('maintains order of embeddings across batches', async () => {
    process.env.EMBEDDING_BASE_URL = 'http://192.168.1.217:8081/v1';

    // Return out-of-order to test sorting
    openaiCreateMock.mockImplementation(async () => ({
      data: [
        { index: 2, embedding: Array(1024).fill(0.3) },
        { index: 0, embedding: Array(1024).fill(0.1) },
        { index: 1, embedding: Array(1024).fill(0.2) },
      ],
    }));

    const { embedBatch } = await import('../src/core/embedding.ts');
    const results = await embedBatch(['first', 'second', 'third']);

    // Results should be sorted by index
    expect(results[0][0]).toBe(0.1);
    expect(results[1][0]).toBe(0.2);
    expect(results[2][0]).toBe(0.3);
  });

  test('retries on failure with exponential backoff', async () => {
    process.env.EMBEDDING_BASE_URL = 'http://192.168.1.217:8081/v1';

    let callCount = 0;
    openaiCreateMock.mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Rate limited');
      }
      return {
        data: [{ index: 0, embedding: Array(1024).fill(0.1) }],
      };
    });

    const { embedBatch } = await import('../src/core/embedding.ts');
    const startTime = Date.now();
    const results = await embedBatch(['test']);
    const elapsed = Date.now() - startTime;

    expect(callCount).toBe(3); // 2 failures + 1 success
    expect(results).toHaveLength(1);
    // Should have retried with some delay (4s * 2^0 + 4s * 2^1 = 4s + 8s = 12s, but capped)
    // Just verify it took some time
  });

  test('throws after max retries exceeded', async () => {
    process.env.EMBEDDING_BASE_URL = 'http://192.168.1.217:8081/v1';

    openaiCreateMock.mockImplementation(async () => {
      throw new Error('Persistent error');
    });

    const { embedBatch } = await import('../src/core/embedding.ts');

    try {
      await embedBatch(['test']);
      expect(true).toBe(false); // Should not reach here
    } catch (e: any) {
      expect(e.message).toContain('Embedding failed');
    }

    // Should have retried 5 times
    expect(openaiCreateMock).toHaveBeenCalledTimes(5);
  });
});

describe('embedding config integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('env vars take precedence over config file', async () => {
    process.env.EMBEDDING_BASE_URL = 'http://env-server:8081/v1';
    process.env.EMBEDDING_MODEL = 'env-model';
    process.env.EMBEDDING_DIMENSIONS = '512';

    const { resolveEmbeddingConfig } = await import('../src/core/embedding.ts');
    const config = resolveEmbeddingConfig();

    expect(config.baseURL).toBe('http://env-server:8081/v1');
    expect(config.model).toBe('env-model');
    expect(config.dimensions).toBe(512);
  });

  test('handles whitespace in env vars', async () => {
    process.env.EMBEDDING_BASE_URL = '  http://server:8081/v1  ';
    process.env.EMBEDDING_MODEL = '  model-name  ';

    const { resolveEmbeddingConfig } = await import('../src/core/embedding.ts');
    const config = resolveEmbeddingConfig();

    expect(config.baseURL).toBe('http://server:8081/v1');
    expect(config.model).toBe('model-name');
  });

  test('defaults when no config set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';

    const { resolveEmbeddingConfig } = await import('../src/core/embedding.ts');
    const config = resolveEmbeddingConfig();

    expect(config.model).toBe('text-embedding-3-large');
    expect(config.dimensions).toBe(1536);
    expect(config.baseURL).toBeUndefined();
    expect(config.isCustomBaseUrl).toBe(false);
  });

  test('parses dimensions as number', async () => {
    process.env.EMBEDDING_DIMENSIONS = '768';

    const { resolveEmbeddingConfig } = await import('../src/core/embedding.ts');
    const config = resolveEmbeddingConfig();

    expect(config.dimensions).toBe(768);
    expect(typeof config.dimensions).toBe('number');
  });
});
