/**
 * E2E Mechanical Tests — Tier 1 (no API keys required)
 *
 * Tests all operations against a real Postgres+pgvector database.
 * Requires DATABASE_URL env var or .env.testing file.
 *
 * Run: DATABASE_URL=... bun test test/e2e/mechanical.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import {
  hasDatabase, setupDB, teardownDB, getEngine, getConn,
  importFixtures, importFixture, time, dumpDBState, FIXTURES_PATH,
} from './helpers.ts';
import { operationsByName, operations } from '../../src/core/operations.ts';
import type { OperationContext } from '../../src/core/operations.ts';
import { importFromContent } from '../../src/core/import-file.ts';

// Skip all E2E tests if no database is configured
const skip = !hasDatabase();
const describeE2E = skip ? describe.skip : describe;

function makeCtx(): OperationContext {
  return {
    engine: getEngine(),
    config: { engine: 'postgres', database_url: process.env.DATABASE_URL! },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    dryRun: false,
  };
}

async function callOp(name: string, params: Record<string, unknown> = {}) {
  const op = operationsByName[name];
  if (!op) throw new Error(`Unknown operation: ${name}`);
  return op.handler(makeCtx(), params);
}

// ─────────────────────────────────────────────────────────────────
// Page CRUD
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Page CRUD', () => {
  beforeAll(async () => {
    await setupDB();
    await importFixtures();
  });
  afterAll(teardownDB);

  test('fixture import creates correct page count', async () => {
    const stats = await callOp('get_stats') as any;
    expect(stats.page_count).toBe(13);
  });

  test('get_page returns correct data for person', async () => {
    const page = await callOp('get_page', { slug: 'people/sarah-chen' }) as any;
    expect(page.title).toBe('Sarah Chen');
    expect(page.type).toBe('person');
    expect(page.compiled_truth).toContain('NovaMind');
    expect(page.tags).toContain('founder');
    expect(page.tags).toContain('yc-w25');
  });

  test('get_page returns correct data for concept', async () => {
    const page = await callOp('get_page', { slug: 'concepts/retrieval-augmented-generation' }) as any;
    expect(page.title).toBe('Retrieval-Augmented Generation');
    expect(page.type).toBe('concept');
    expect(page.compiled_truth).toContain('検索拡張生成');
  });

  test('get_page for company includes key details', async () => {
    const page = await callOp('get_page', { slug: 'companies/novamind' }) as any;
    expect(page.type).toBe('company');
    expect(page.compiled_truth).toContain('Sarah Chen');
  });

  test('list_pages type filter returns correct count', async () => {
    const people = await callOp('list_pages', { type: 'person' }) as any[];
    expect(people.length).toBe(3);

    const companies = await callOp('list_pages', { type: 'company' }) as any[];
    expect(companies.length).toBe(2);

    const concepts = await callOp('list_pages', { type: 'concept' }) as any[];
    expect(concepts.length).toBe(3);
  });

  test('list_pages tag filter works', async () => {
    const ycPages = await callOp('list_pages', { tag: 'yc-w25' }) as any[];
    expect(ycPages.length).toBeGreaterThanOrEqual(2);
    expect(ycPages.some((p: any) => p.slug === 'people/sarah-chen')).toBe(true);
  });

  test('put_page updates existing page', async () => {
    const updated = readFileSync(join(FIXTURES_PATH, 'people/sarah-chen.md'), 'utf-8')
      .replace('Stanford CS class of 2020', 'Stanford CS class of 2019');
    await callOp('put_page', { slug: 'people/sarah-chen', content: updated });
    const page = await callOp('get_page', { slug: 'people/sarah-chen' }) as any;
    expect(page.compiled_truth).toContain('2019');
  });

  test('delete_page removes page and others survive', async () => {
    await callOp('delete_page', { slug: 'sources/crustdata-sarah-chen' });
    const stats = await callOp('get_stats') as any;
    expect(stats.page_count).toBe(12);

    // Other pages still exist
    const sarah = await callOp('get_page', { slug: 'people/sarah-chen' }) as any;
    expect(sarah.title).toBe('Sarah Chen');
  });
});

// ─────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Search', () => {
  beforeAll(async () => {
    await setupDB();
    await importFixtures();
  });
  afterAll(teardownDB);

  test('keyword search for "NovaMind" returns multiple hits', async () => {
    const results = await callOp('search', { query: 'NovaMind' }) as any[];
    expect(results.length).toBeGreaterThanOrEqual(3);
    const slugs = results.map((r: any) => r.slug);
    expect(slugs).toContain('companies/novamind');
  });

  test('keyword search for "Threshold Ventures" finds investor', async () => {
    const results = await callOp('search', { query: 'Threshold Ventures' }) as any[];
    expect(results.length).toBeGreaterThanOrEqual(1);
    const slugs = results.map((r: any) => r.slug);
    expect(slugs).toContain('companies/threshold-ventures');
  });

  test('keyword search for "Stanford" finds Priya', async () => {
    const results = await callOp('search', { query: 'Stanford' }) as any[];
    expect(results.length).toBeGreaterThanOrEqual(1);
    const slugs = results.map((r: any) => r.slug);
    expect(slugs).toContain('people/priya-patel');
  });

  test('keyword search for nonexistent term returns empty', async () => {
    const results = await callOp('search', { query: 'xyznonexistent123' }) as any[];
    expect(results.length).toBe(0);
  });

  test('search quality: precision@5 for known queries', async () => {
    const groundTruth: Record<string, string[]> = {
      'NovaMind': ['people/sarah-chen', 'companies/novamind', 'deals/novamind-seed'],
      'hybrid search': ['concepts/hybrid-search', 'concepts/retrieval-augmented-generation'],
      'compiled truth': ['concepts/compiled-truth'],
    };

    const scores: Record<string, number> = {};
    for (const [query, expected] of Object.entries(groundTruth)) {
      const results = await callOp('search', { query, limit: 5 }) as any[];
      const topSlugs = results.slice(0, 5).map((r: any) => r.slug);
      const hits = expected.filter(e => topSlugs.includes(e));
      scores[query] = hits.length / Math.min(expected.length, 5);
    }

    console.log('\n  Search Quality (precision@5, keyword-only):');
    for (const [query, score] of Object.entries(scores)) {
      console.log(`    "${query}": ${(score * 100).toFixed(0)}%`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// Links
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Links', () => {
  beforeAll(async () => {
    await setupDB();
    await importFixtures();
  });
  afterAll(teardownDB);

  test('add_link + get_links + get_backlinks round trip', async () => {
    await callOp('add_link', {
      from: 'people/sarah-chen',
      to: 'companies/novamind',
      link_type: 'founded',
      context: 'CEO and founder since 2024',
    });

    const links = await callOp('get_links', { slug: 'people/sarah-chen' }) as any[];
    expect(links.some((l: any) => l.to_slug === 'companies/novamind' || l.to_page_slug === 'companies/novamind')).toBe(true);

    const backlinks = await callOp('get_backlinks', { slug: 'companies/novamind' }) as any[];
    expect(backlinks.some((l: any) => l.from_slug === 'people/sarah-chen' || l.from_page_slug === 'people/sarah-chen')).toBe(true);
  });

  test('traverse_graph finds connected pages', async () => {
    await callOp('add_link', { from: 'people/sarah-chen', to: 'companies/novamind', link_type: 'founded' });
    await callOp('add_link', { from: 'companies/novamind', to: 'deals/novamind-seed', link_type: 'raised' });

    const graph = await callOp('traverse_graph', { slug: 'people/sarah-chen', depth: 2 }) as any;
    expect(graph).toBeDefined();
  });

  test('remove_link removes the link', async () => {
    await callOp('add_link', { from: 'people/marcus-reid', to: 'companies/threshold-ventures' });
    await callOp('remove_link', { from: 'people/marcus-reid', to: 'companies/threshold-ventures' });

    const links = await callOp('get_links', { slug: 'people/marcus-reid' }) as any[];
    const hasLink = links.some((l: any) =>
      (l.to_slug || l.to_page_slug) === 'companies/threshold-ventures'
    );
    expect(hasLink).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// Tags
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Tags', () => {
  beforeAll(async () => {
    await setupDB();
    await importFixtures();
  });
  afterAll(teardownDB);

  test('get_tags returns imported tags', async () => {
    const tags = await callOp('get_tags', { slug: 'people/sarah-chen' }) as string[];
    expect(tags).toContain('founder');
    expect(tags).toContain('yc-w25');
    expect(tags).toContain('ai-agents');
  });

  test('add_tag + remove_tag round trip', async () => {
    await callOp('add_tag', { slug: 'people/marcus-reid', tag: 'test-tag' });
    let tags = await callOp('get_tags', { slug: 'people/marcus-reid' }) as string[];
    expect(tags).toContain('test-tag');

    await callOp('remove_tag', { slug: 'people/marcus-reid', tag: 'test-tag' });
    tags = await callOp('get_tags', { slug: 'people/marcus-reid' }) as string[];
    expect(tags).not.toContain('test-tag');
  });

  test('list_pages with tag filter finds tagged pages', async () => {
    await callOp('add_tag', { slug: 'people/priya-patel', tag: 'test-search-tag' });
    const pages = await callOp('list_pages', { tag: 'test-search-tag' }) as any[];
    expect(pages.length).toBe(1);
    expect(pages[0].slug).toBe('people/priya-patel');
  });
});

// ─────────────────────────────────────────────────────────────────
// Timeline
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Timeline', () => {
  beforeAll(async () => {
    await setupDB();
    await importFixtures();
  });
  afterAll(teardownDB);

  test('add_timeline_entry + get_timeline round trip', async () => {
    await callOp('add_timeline_entry', {
      slug: 'people/sarah-chen',
      date: '2025-04-01',
      summary: 'Test timeline entry',
      detail: 'Added via E2E test',
      source: 'e2e-test',
    });

    const timeline = await callOp('get_timeline', { slug: 'people/sarah-chen' }) as any[];
    expect(timeline.length).toBeGreaterThanOrEqual(1);
    const entry = timeline.find((e: any) => e.summary === 'Test timeline entry');
    expect(entry).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// Versions
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Versions', () => {
  beforeAll(async () => {
    await setupDB();
    await importFixtures();
  });
  afterAll(teardownDB);

  test('put_page creates version, revert restores', async () => {
    const original = await callOp('get_page', { slug: 'people/sarah-chen' }) as any;

    // Modify page
    const modified = readFileSync(join(FIXTURES_PATH, 'people/sarah-chen.md'), 'utf-8')
      .replace('Sarah Chen', 'Sarah Chen (Modified)');
    await callOp('put_page', { slug: 'people/sarah-chen', content: modified });

    // Check versions exist
    const versions = await callOp('get_versions', { slug: 'people/sarah-chen' }) as any[];
    expect(versions.length).toBeGreaterThanOrEqual(1);

    // Revert to first version
    const firstVersion = versions[versions.length - 1];
    await callOp('revert_version', { slug: 'people/sarah-chen', version_id: firstVersion.id });

    const reverted = await callOp('get_page', { slug: 'people/sarah-chen' }) as any;
    expect(reverted.compiled_truth).not.toContain('(Modified)');
  });
});

// ─────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Admin', () => {
  beforeAll(async () => {
    await setupDB();
    await importFixtures();
  });
  afterAll(teardownDB);

  test('get_stats returns valid structure', async () => {
    const stats = await callOp('get_stats') as any;
    expect(stats.page_count).toBe(13);
    expect(typeof stats.chunk_count).toBe('number');
  });

  test('get_health returns valid structure', async () => {
    const health = await callOp('get_health') as any;
    expect(health).toBeDefined();
    expect(typeof health.total_pages).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────
// Chunks & Resolution
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Chunks & Resolution', () => {
  beforeAll(async () => {
    await setupDB();
    await importFixtures();
  });
  afterAll(teardownDB);

  test('get_chunks returns chunks for imported page', async () => {
    const chunks = await callOp('get_chunks', { slug: 'people/sarah-chen' }) as any[];
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].chunk_text).toBeTruthy();
  });

  test('resolve_slugs finds partial match', async () => {
    const matches = await callOp('resolve_slugs', { partial: 'sarah' }) as string[];
    expect(matches).toContain('people/sarah-chen');
  });

  test('resolve_slugs finds exact match', async () => {
    const matches = await callOp('resolve_slugs', { partial: 'people/sarah-chen' }) as string[];
    expect(matches).toContain('people/sarah-chen');
  });
});

// ─────────────────────────────────────────────────────────────────
// Ingest Log & Raw Data
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Ingest Log & Raw Data', () => {
  beforeAll(async () => {
    await setupDB();
    await importFixtures();
  });
  afterAll(teardownDB);

  test('log_ingest + get_ingest_log round trip', async () => {
    await callOp('log_ingest', {
      source_type: 'e2e-test',
      source_ref: 'test-run-1',
      pages_updated: ['people/sarah-chen', 'companies/novamind'],
      summary: 'E2E test ingest',
    });

    const log = await callOp('get_ingest_log', { limit: 5 }) as any[];
    expect(log.length).toBeGreaterThanOrEqual(1);
    const entry = log.find((e: any) => e.source_ref === 'test-run-1');
    expect(entry).toBeDefined();
    expect(entry.source_type).toBe('e2e-test');
  });

  test('put_raw_data + get_raw_data round trip', async () => {
    const testData = { education: 'Stanford CS 2020', title: 'CEO' };
    await callOp('put_raw_data', {
      slug: 'people/sarah-chen',
      source: 'crustdata',
      data: testData,
    });

    const raw = await callOp('get_raw_data', {
      slug: 'people/sarah-chen',
      source: 'crustdata',
    }) as any[];
    expect(raw.length).toBeGreaterThanOrEqual(1);
    expect(raw[0].data).toEqual(testData);
  });
});

// ─────────────────────────────────────────────────────────────────
// Files (stub verification)
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Files', () => {
  beforeAll(async () => {
    await setupDB();
    await importFixtures();
  });
  afterAll(teardownDB);

  test('file_list returns empty initially', async () => {
    const files = await callOp('file_list', {}) as any[];
    expect(files.length).toBe(0);
  });

  test('file_upload stores metadata + file_list shows it', async () => {
    // Create a temp file
    const tmpDir = mkdtempSync(join(tmpdir(), 'gbrain-e2e-'));
    const tmpFile = join(tmpDir, 'test-doc.pdf');
    writeFileSync(tmpFile, 'fake pdf content');

    try {
      const result = await callOp('file_upload', {
        path: tmpFile,
        page_slug: 'people/sarah-chen',
      }) as any;
      expect(result.status).toBe('uploaded');
      expect(result.storage_path).toContain('sarah-chen');

      // Verify file_list
      const files = await callOp('file_list', {}) as any[];
      expect(files.length).toBe(1);

      // Verify file_url returns URI format
      const url = await callOp('file_url', { storage_path: result.storage_path }) as any;
      expect(url.url).toContain('gbrain:files/');
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// Idempotency Stress
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Idempotency', () => {
  beforeAll(async () => {
    await setupDB();
  });
  afterAll(teardownDB);

  test('double import produces no duplicates', async () => {
    // First import
    await importFixtures();
    const stats1 = await callOp('get_stats') as any;

    // Second import (identical content)
    await importFixtures();
    const stats2 = await callOp('get_stats') as any;

    expect(stats2.page_count).toBe(stats1.page_count);
    expect(stats2.chunk_count).toBe(stats1.chunk_count);
  });

  test('modify one fixture, reimport, only that page updates', async () => {
    await importFixtures();
    const engine = getEngine();

    // Modify sarah-chen content
    const modified = readFileSync(join(FIXTURES_PATH, 'people/sarah-chen.md'), 'utf-8')
      .replace('Stanford CS', 'MIT CS');

    const result = await importFromContent(engine, 'people/sarah-chen', modified, { noEmbed: true });
    expect(result.status).toBe('imported');

    // Other pages should have been skipped if reimported
    const content = readFileSync(join(FIXTURES_PATH, 'people/marcus-reid.md'), 'utf-8');
    const { parseMarkdown } = await import('../../src/core/markdown.ts');
    const parsed = parseMarkdown(content, 'people/marcus-reid.md');
    const result2 = await importFromContent(engine, parsed.slug, content, { noEmbed: true });
    expect(result2.status).toBe('skipped');
  });
});

// ─────────────────────────────────────────────────────────────────
// Setup Journey (CLI subprocess tests)
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Setup Journey', () => {
  beforeAll(async () => {
    await setupDB();
  });
  afterAll(teardownDB);

  test('gbrain init --non-interactive connects and initializes', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'src/cli.ts', 'init', '--non-interactive', '--url', process.env.DATABASE_URL!],
      cwd: join(import.meta.dir, '../..'),
      env: { ...process.env },
    });
    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('Brain ready');
  });

  test('gbrain import imports fixtures via CLI', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'src/cli.ts', 'import', FIXTURES_PATH],
      cwd: join(import.meta.dir, '../..'),
      env: { ...process.env },
    });
    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(stdout).toMatch(/\d+ imported/);
  });

  test('gbrain search returns results via CLI', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'src/cli.ts', 'search', 'NovaMind'],
      cwd: join(import.meta.dir, '../..'),
      env: { ...process.env },
    });
    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  test('gbrain stats shows page count via CLI', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'src/cli.ts', 'stats'],
      cwd: join(import.meta.dir, '../..'),
      env: { ...process.env },
    });
    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
  });

  test('gbrain health runs via CLI', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'src/cli.ts', 'health'],
      cwd: join(import.meta.dir, '../..'),
      env: { ...process.env },
    });
    expect(result.exitCode).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// Init Edge Cases
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Init Edge Cases', () => {
  afterAll(teardownDB);

  test('init --non-interactive without URL fails gracefully', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'src/cli.ts', 'init', '--non-interactive'],
      cwd: join(import.meta.dir, '../..'),
      env: { ...process.env, DATABASE_URL: undefined, GBRAIN_DATABASE_URL: undefined },
    });
    expect(result.exitCode).not.toBe(0);
  });

  test('double init is idempotent', async () => {
    await setupDB();
    const conn = getConn();
    const before = await conn.unsafe(`SELECT count(*) as n FROM information_schema.tables WHERE table_schema = 'public'`);

    // Re-init
    const { initSchema } = await import('../../src/core/db.ts');
    await initSchema();

    const after = await conn.unsafe(`SELECT count(*) as n FROM information_schema.tables WHERE table_schema = 'public'`);
    expect(after[0].n).toBe(before[0].n);
  });

  test('init then import then re-init preserves pages', async () => {
    await setupDB();
    await importFixtures();
    const before = await callOp('get_stats') as any;

    const { initSchema } = await import('../../src/core/db.ts');
    await initSchema();

    const after = await callOp('get_stats') as any;
    expect(after.page_count).toBe(before.page_count);
  });
});

// ─────────────────────────────────────────────────────────────────
// Schema Idempotency
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Schema Idempotency', () => {
  beforeAll(async () => {
    await setupDB();
  });
  afterAll(teardownDB);

  test('initSchema twice produces no errors and same object count', async () => {
    const conn = getConn();
    const tables1 = await conn.unsafe(`SELECT count(*) as n FROM information_schema.tables WHERE table_schema = 'public'`);
    const indexes1 = await conn.unsafe(`SELECT count(*) as n FROM pg_indexes WHERE schemaname = 'public'`);

    const { initSchema } = await import('../../src/core/db.ts');
    await initSchema();

    const tables2 = await conn.unsafe(`SELECT count(*) as n FROM information_schema.tables WHERE table_schema = 'public'`);
    const indexes2 = await conn.unsafe(`SELECT count(*) as n FROM pg_indexes WHERE schemaname = 'public'`);

    expect(tables2[0].n).toBe(tables1[0].n);
    expect(indexes2[0].n).toBe(indexes1[0].n);
  });
});

// ─────────────────────────────────────────────────────────────────
// Schema Diff Guard
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Schema Diff Guard', () => {
  beforeAll(async () => {
    await setupDB();
  });
  afterAll(teardownDB);

  test('all expected tables exist', async () => {
    const conn = getConn();
    const tables = await conn.unsafe(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tableNames = tables.map((t: any) => t.table_name);

    const expected = [
      'config', 'content_chunks', 'files', 'ingest_log',
      'links', 'page_versions', 'pages', 'raw_data',
      'tags', 'timeline_entries',
    ];
    for (const table of expected) {
      expect(tableNames).toContain(table);
    }
  });

  test('pgvector extension is installed', async () => {
    const conn = getConn();
    const ext = await conn.unsafe(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
    expect(ext.length).toBe(1);
  });

  test('pg_trgm extension is installed', async () => {
    const conn = getConn();
    const ext = await conn.unsafe(`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`);
    expect(ext.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────
// Performance Baselines
// ─────────────────────────────────────────────────────────────────

describeE2E('E2E: Performance Baselines', () => {
  beforeAll(async () => {
    await setupDB();
  });
  afterAll(teardownDB);

  test('import + search + link performance', async () => {
    const [_, importMs] = await time(importFixtures);

    const searchTimes: number[] = [];
    for (const q of ['NovaMind', 'hybrid search', 'Stanford', 'investor', 'compiled truth']) {
      const [__, ms] = await time(() => callOp('search', { query: q }));
      searchTimes.push(ms);
    }

    const [___, linkMs] = await time(async () => {
      await callOp('add_link', { from: 'people/sarah-chen', to: 'companies/novamind' });
      await callOp('get_backlinks', { slug: 'companies/novamind' });
    });

    searchTimes.sort((a, b) => a - b);
    const p50 = searchTimes[Math.floor(searchTimes.length * 0.5)];
    const p99 = searchTimes[searchTimes.length - 1];

    console.log('\n  Performance Baselines:');
    console.log(`    Import 13 fixtures: ${importMs.toFixed(0)}ms`);
    console.log(`    Search p50: ${p50.toFixed(0)}ms`);
    console.log(`    Search p99: ${p99.toFixed(0)}ms`);
    console.log(`    Link + backlink: ${linkMs.toFixed(0)}ms`);
  });
});
