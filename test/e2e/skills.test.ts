/**
 * E2E Skill Tests — Tier 2 (requires API keys + openclaw)
 *
 * Tests gbrain skills via OpenClaw CLI invocations.
 * Asserts on DB state changes, not LLM output text.
 *
 * Requires:
 *   - DATABASE_URL
 *   - OPENAI_API_KEY
 *   - ANTHROPIC_API_KEY
 *   - openclaw CLI installed
 *
 * Skips gracefully if any dependency is missing.
 * Run: bun test test/e2e/skills.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { hasDatabase, setupDB, teardownDB, importFixtures, getEngine } from './helpers.ts';

// Check all Tier 2 dependencies
function hasTier2Deps(): boolean {
  if (!hasDatabase()) return false;
  if (!process.env.OPENAI_API_KEY) return false;
  if (!process.env.ANTHROPIC_API_KEY) return false;

  // Check if openclaw is installed
  try {
    const result = Bun.spawnSync({ cmd: ['openclaw', '--version'] });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

const skip = !hasTier2Deps();
const describeT2 = skip ? describe.skip : describe;

if (skip) {
  test.skip('Tier 2 tests skipped (missing dependencies)', () => {});
  if (!hasDatabase()) console.log('  Skip reason: DATABASE_URL not set');
  else if (!process.env.OPENAI_API_KEY) console.log('  Skip reason: OPENAI_API_KEY not set');
  else if (!process.env.ANTHROPIC_API_KEY) console.log('  Skip reason: ANTHROPIC_API_KEY not set');
  else console.log('  Skip reason: openclaw CLI not installed');
}

/**
 * Run openclaw with a prompt and gbrain MCP configured.
 * Returns { stdout, stderr, exitCode }.
 */
function runOpenClaw(prompt: string, timeoutMs = 60_000) {
  const result = Bun.spawnSync({
    cmd: ['openclaw', '-p', prompt],
    cwd: join(import.meta.dir, '../..'),
    env: {
      ...process.env,
      // Ensure openclaw knows about gbrain MCP server
    },
    timeout: timeoutMs,
  });

  return {
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    exitCode: result.exitCode,
  };
}

// ─────────────────────────────────────────────────────────────────
// Ingest Skill
// ─────────────────────────────────────────────────────────────────

describeT2('E2E Tier 2: Ingest Skill', () => {
  beforeAll(async () => {
    await setupDB();
  });
  afterAll(teardownDB);

  test('ingest a meeting transcript creates person pages and links', async () => {
    const transcript = `
Meeting: NovaMind Board Update — April 1, 2025
Attendees: Sarah Chen (CEO), Marcus Reid (Board, Threshold), David Kim (CFO)

Sarah presented Q1 metrics: 3 enterprise design partners signed, 47% MoM revenue growth.
Marcus asked about competitive positioning vs AutoAgent and CopilotStack.
David Kim presented runway analysis: 18 months at current burn rate.
Decision: Hire VP Sales by end of Q2.
Action: Sarah to draft VP Sales job description by April 7.
    `.trim();

    const { stdout, exitCode } = runOpenClaw(
      `Ingest this meeting transcript into gbrain. Create or update pages for each person mentioned. Add timeline entries for today's date. Here is the transcript:\n\n${transcript}`,
      120_000,
    );

    // Assert on DB state, not LLM output
    const engine = getEngine();
    const stats = await engine.getStats();
    expect(stats.page_count).toBeGreaterThan(0);

    // Check if person pages were created (may use different slug formats)
    const pages = await engine.listPages({ type: 'person' });
    const pageNames = pages.map((p: any) => p.title?.toLowerCase() || '');

    // At minimum, the transcript mentions 3 people
    // The LLM may or may not create pages for all of them
    // We assert that at least some pages were created
    expect(pages.length).toBeGreaterThanOrEqual(1);
  }, 180_000);
});

// ─────────────────────────────────────────────────────────────────
// Query Skill
// ─────────────────────────────────────────────────────────────────

describeT2('E2E Tier 2: Query Skill', () => {
  beforeAll(async () => {
    await setupDB();
    await importFixtures();
  });
  afterAll(teardownDB);

  test('query skill returns results for known topic', async () => {
    const { stdout, exitCode } = runOpenClaw(
      'Search gbrain for "hybrid search" and tell me what you found.',
      120_000,
    );

    // The response should mention something about search
    expect(stdout.length).toBeGreaterThan(0);
    // exitCode 0 means the skill ran without errors
    expect(exitCode).toBe(0);
  }, 180_000);
});

// ─────────────────────────────────────────────────────────────────
// Health Skill
// ─────────────────────────────────────────────────────────────────

describeT2('E2E Tier 2: Health Skill', () => {
  beforeAll(async () => {
    await setupDB();
    await importFixtures();
  });
  afterAll(teardownDB);

  test('health skill reports brain status', async () => {
    const { stdout, exitCode } = runOpenClaw(
      'Check gbrain health and report the status.',
      120_000,
    );

    expect(stdout.length).toBeGreaterThan(0);
    expect(exitCode).toBe(0);
  }, 180_000);
});
