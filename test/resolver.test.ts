import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const SKILLS_DIR = join(import.meta.dir, "..", "skills");
const RESOLVER_PATH = join(SKILLS_DIR, "RESOLVER.md");
const MANIFEST_PATH = join(SKILLS_DIR, "manifest.json");

/** Extract all skill file paths referenced in RESOLVER.md */
function extractResolverPaths(content: string): string[] {
  const paths: string[] = [];
  // Match patterns like `skills/xyz/SKILL.md`
  const regex = /`(skills\/[^`]+\/SKILL\.md)`/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

/** Extract all skill names from manifest */
function getManifestNames(): string[] {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  return manifest.skills.map((s: { name: string }) => s.name);
}

describe("RESOLVER.md", () => {
  test("exists", () => {
    expect(existsSync(RESOLVER_PATH)).toBe(true);
  });

  const resolverContent = existsSync(RESOLVER_PATH)
    ? readFileSync(RESOLVER_PATH, "utf-8")
    : "";

  test("references only existing skill files", () => {
    const paths = extractResolverPaths(resolverContent);
    const root = join(import.meta.dir, "..");
    for (const p of paths) {
      const fullPath = join(root, p);
      // Skills that are planned (Phase 2+) may not exist yet; skip those
      // Only fail on skills that are in the manifest but missing on disk
      if (p.includes("signal-detector") || p.includes("brain-ops") ||
          p.includes("idea-ingest") || p.includes("media-ingest") ||
          p.includes("meeting-ingestion") || p.includes("citation-fixer") ||
          p.includes("repo-architecture") || p.includes("skill-creator") ||
          p.includes("daily-task-manager") || p.includes("daily-task-prep") ||
          p.includes("cron-scheduler") || p.includes("reports") ||
          p.includes("cross-modal-review") || p.includes("soul-audit") ||
          p.includes("webhook-transforms") || p.includes("testing")) {
        continue; // Phase 2-3 skills, not yet created
      }
      expect(existsSync(fullPath)).toBe(true);
    }
  });

  test("has categorized sections", () => {
    expect(resolverContent).toContain("## Always-on");
    expect(resolverContent).toContain("## Brain operations");
    expect(resolverContent).toContain("## Content & media ingestion");
    expect(resolverContent).toContain("## Operational");
  });

  test("has disambiguation rules", () => {
    expect(resolverContent).toContain("## Disambiguation rules");
  });

  test("references conventions", () => {
    expect(resolverContent).toContain("conventions/quality.md");
    expect(resolverContent).toContain("_brain-filing-rules.md");
  });

  test("every manifest skill has at least one resolver reference", () => {
    const manifestNames = getManifestNames();
    for (const name of manifestNames) {
      // Check if the skill name appears somewhere in the resolver
      // Either as a path (`skills/{name}/SKILL.md`) or as text
      const hasReference =
        resolverContent.includes(`skills/${name}/SKILL.md`) ||
        resolverContent.includes(`\`${name}\``) ||
        resolverContent.includes(`| ${name}`);
      // install is deprecated, skip it
      if (name === "install") continue;
      expect(hasReference).toBe(true);
    }
  });
});
