import { describe, test, expect } from 'bun:test';

// We can't easily mock process.execPath in bun, so we test the upgrade
// command's --help output and the detection logic via subprocess

describe('upgrade command', () => {
  test('--help prints usage and exits 0', async () => {
    const proc = Bun.spawn(['bun', 'run', 'src/cli.ts', 'upgrade', '--help'], {
      cwd: new URL('..', import.meta.url).pathname,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(stdout).toContain('Usage: gbrain upgrade');
    expect(stdout).toContain('Detects install method');
    expect(exitCode).toBe(0);
  });

  test('-h also prints usage', async () => {
    const proc = Bun.spawn(['bun', 'run', 'src/cli.ts', 'upgrade', '-h'], {
      cwd: new URL('..', import.meta.url).pathname,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(stdout).toContain('Usage: gbrain upgrade');
    expect(exitCode).toBe(0);
  });
});

describe('detectInstallMethod heuristic (source analysis)', () => {
  // Read the source and verify the detection order is correct
  const { readFileSync } = require('fs');
  const source = readFileSync(
    new URL('../src/commands/upgrade.ts', import.meta.url),
    'utf-8',
  );

  test('checks node_modules before binary', () => {
    const nodeModulesIdx = source.indexOf('node_modules');
    const binaryIdx = source.indexOf("endsWith('/gbrain')");
    expect(nodeModulesIdx).toBeLessThan(binaryIdx);
  });

  test('checks binary before clawhub', () => {
    const binaryIdx = source.indexOf("endsWith('/gbrain')");
    const clawhubIdx = source.indexOf("clawhub --version");
    expect(binaryIdx).toBeLessThan(clawhubIdx);
  });

  test('uses clawhub --version, not which clawhub', () => {
    expect(source).toContain("clawhub --version");
    expect(source).not.toContain('which clawhub');
  });

  test('has timeout on upgrade execSync calls', () => {
    // Count timeout occurrences in execSync calls
    const timeoutMatches = source.match(/timeout:\s*\d+/g) || [];
    expect(timeoutMatches.length).toBeGreaterThanOrEqual(2); // bun + clawhub detection at minimum
  });

  test('return type is bun | binary | clawhub | unknown', () => {
    expect(source).toContain("'bun' | 'binary' | 'clawhub' | 'unknown'");
  });

  test('does not reference npm in case labels or messages', () => {
    // Should not have case 'npm' or 'Upgrading via npm'
    expect(source).not.toContain("case 'npm'");
    expect(source).not.toContain('via npm');
    expect(source).not.toContain('npm upgrade');
  });
});

describe('post-upgrade body printing + auto_execute', () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('fs');
  const { join } = require('path');
  const { tmpdir } = require('os');

  async function runPostUpgradeWith(opts: {
    args?: string[];
    migrationContent: string;
    homeDir?: string;
  }) {
    const tmp = opts.homeDir || mkdtempSync(join(tmpdir(), 'gbrain-pu-'));
    const gbrainDir = join(tmp, '.gbrain');
    mkdirSync(gbrainDir, { recursive: true });
    // from = 9.99.98 isolates the test to the synthetic v9.99.99 migration only.
    // Using a low from (e.g. 0.10.0) would also pick up real shipped migrations.
    writeFileSync(
      join(gbrainDir, 'upgrade-state.json'),
      JSON.stringify({ last_upgrade: { from: '9.99.98', to: '9.99.99', ts: '2026-04-18T00:00:00Z' } }),
    );

    // Use the real migrations dir (cwd-resolved candidate). Write a test migration there.
    const migrationsDir = new URL('../skills/migrations', import.meta.url).pathname;
    const testFile = join(migrationsDir, 'v9.99.99.md');
    writeFileSync(testFile, opts.migrationContent);

    try {
      const proc = Bun.spawn(['bun', 'run', 'src/cli.ts', 'post-upgrade', ...(opts.args || [])], {
        cwd: new URL('..', import.meta.url).pathname,
        env: { ...process.env, HOME: tmp },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      return { stdout, stderr, exitCode };
    } finally {
      rmSync(testFile, { force: true });
      if (!opts.homeDir) rmSync(tmp, { recursive: true, force: true });
    }
  }

  test('prints headline and full body, not just frontmatter', async () => {
    const content = `---
version: 9.99.99
feature_pitch:
  headline: "Test feature"
  description: "Short blurb"
---

# v9.99.99 Body

Step 1: do this thing.
Step 2: do the other thing.
`;
    const { stdout, exitCode } = await runPostUpgradeWith({ migrationContent: content });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('NEW: Test feature');
    expect(stdout).toContain('Migration steps');
    expect(stdout).toContain('Step 1: do this thing.');
    expect(stdout).toContain('Step 2: do the other thing.');
  });

  test('--execute without --yes only previews auto_execute commands', async () => {
    const content = `---
version: 9.99.99
feature_pitch:
  headline: "Test"
auto_execute:
  - cmd: echo hello-from-test-migration
    description: Sample command
---

Body.
`;
    const { stdout, exitCode } = await runPostUpgradeWith({
      args: ['--execute'],
      migrationContent: content,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Auto-execute plan');
    expect(stdout).toContain('echo hello-from-test-migration');
    expect(stdout).toContain('Sample command');
    expect(stdout).toContain('Re-run with --execute --yes');
    // Verify command did not execute: the actual echo output would not be preceded
    // by the literal "$ " prefix that the plan listing uses.
    expect(stdout).not.toMatch(/^hello-from-test-migration$/m);
  });

  test('--execute --yes runs the auto_execute commands', async () => {
    const content = `---
version: 9.99.99
feature_pitch:
  headline: "Test"
auto_execute:
  - cmd: echo executed-marker-string
    description: Sample
---

Body.
`;
    const { stdout, exitCode } = await runPostUpgradeWith({
      args: ['--execute', '--yes'],
      migrationContent: content,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('executed-marker-string');
    expect(stdout).toContain('All v9.99.99 auto_execute commands completed.');
  });

  test('migration with no auto_execute is handled gracefully', async () => {
    const content = `---
version: 9.99.99
feature_pitch:
  headline: "Test"
---

Manual steps only.
`;
    const { stdout, exitCode } = await runPostUpgradeWith({
      args: ['--execute', '--yes'],
      migrationContent: content,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('declares no auto_execute commands');
  });

  test('--help prints usage', async () => {
    const proc = Bun.spawn(['bun', 'run', 'src/cli.ts', 'post-upgrade', '--help'], {
      cwd: new URL('..', import.meta.url).pathname,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: gbrain post-upgrade');
    expect(stdout).toContain('--execute');
    expect(stdout).toContain('--yes');
  });
});
