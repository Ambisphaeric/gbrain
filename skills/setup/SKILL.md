# Setup GBrain

Set up GBrain from scratch. Target: working brain in under 2 minutes.

## Prerequisites

- A Supabase account (Pro tier recommended: $25/mo for 8GB DB + 100GB storage)
- An OpenAI API key (for semantic search embeddings, ~$4-5 for 7,500 pages)
- A git-backed markdown knowledge base (or start fresh)

## Phase A: Auto-Provision (Supabase CLI)

Check if the Supabase CLI is available. If it is, use the fast path:

1. Tell the user: "I'll set up Supabase for you. Click 'Authorize' when your browser opens."
2. Run `supabase login` (opens browser for OAuth)
3. Run `supabase projects create --name gbrain --region us-east-1`
4. Extract the database connection URL from `supabase projects api-keys`
5. Initialize gbrain with the connection URL in non-interactive mode
6. Proceed to Phase C automatically

## Phase B: Manual Fallback

If the Supabase CLI is not available, guide the user:

1. "Log into Supabase and add a credit card: https://supabase.com/dashboard/account/billing"
2. "Create a new project: https://supabase.com/dashboard/new/_"
   - Name: gbrain
   - Region: closest to you
   - Generate a strong password
3. "Go to Project Settings > Database and copy the connection string (URI format)"
   - Paste it here
4. Initialize gbrain with the provided URL in non-interactive mode

That's it. One copy-paste. The agent does everything else.

## Phase C: First Import

1. **Discover markdown repos.** Scan the environment for git repos with markdown content.

```bash
echo "=== GBrain Environment Discovery ==="
for dir in /data/* ~/git/* ~/Documents/* 2>/dev/null; do
  if [ -d "$dir/.git" ]; then
    md_count=$(find "$dir" -name "*.md" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$md_count" -gt 10 ]; then
      total_size=$(du -sh "$dir" 2>/dev/null | cut -f1)
      echo "  $dir ($total_size, $md_count .md files)"
    fi
  fi
done
echo "=== Discovery Complete ==="
```

2. **Import the best candidate.** Import the recommended directory into gbrain.
3. **Prove search works.** Search gbrain for a topic from the imported data. Show results immediately.
4. **Start embeddings.** Refresh stale embeddings in gbrain (runs in background). Keyword search works NOW, semantic search improves as embeddings complete.

## Phase D: AGENTS.md Injection

Auto-inject gbrain instructions into the project's AGENTS.md (or equivalent). Use a delimited managed block that's upgrade-safe:

```markdown
<!-- gbrain:start -->
## GBrain (Knowledge Search)

GBrain indexes your knowledge base for fast search. Always search before answering
questions about people, companies, deals, or anything in the brain.

### How to use
- Search gbrain for any topic before answering questions
- After writing new content, sync the repository to gbrain
- Upload binary files to gbrain storage instead of committing to git
- Check gbrain health periodically

### Rules
1. **Search the brain first.** Before answering any question about people, companies,
   deals, meetings, or strategy, search gbrain. Your memory of file contents goes
   stale; the database doesn't.
2. **Never commit binaries to git.** Upload to gbrain file storage instead.
3. **After writing to the brain repo,** sync to gbrain immediately.
<!-- gbrain:end -->
```

## Phase E: Health Check

After setup is complete, check gbrain health. Every dimension should be healthy.
Report the final state to the user:
- Page count and statistics
- Embedding coverage
- Search verification (run a sample query)

## Error Handling

Every error tells you what happened, why, and how to fix it:

| What You See | Why | Fix |
|---|---|---|
| Connection refused | Supabase project paused or wrong URL | supabase.com/dashboard > Restore |
| Password authentication failed | Wrong password | Project Settings > Database > Reset password |
| pgvector not available | Extension not enabled | Run CREATE EXTENSION vector in SQL Editor |
| OpenAI key invalid | Expired or wrong key | platform.openai.com/api-keys > Create new |
| No pages found | Query before import | Import files into gbrain first |

## Tools Used

- Initialize gbrain (via CLI: gbrain init --non-interactive --url ...)
- Import files into gbrain (via CLI: gbrain import)
- Search gbrain (query)
- Check gbrain health (get_health)
- Get gbrain statistics (get_stats)
