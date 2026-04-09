# Briefing Skill

Compile a daily briefing from brain context.

## Workflow

1. **Today's meetings.** For each meeting on the calendar:
   - Search gbrain for each participant by name
   - Read their pages from gbrain for compiled_truth context
   - Summarize: who they are, recent timeline, relationship to you
2. **Active deals.** List deal pages in gbrain filtered to active status:
   - Deadlines approaching in the next 7 days
   - Recent timeline entries (last 7 days)
3. **Time-sensitive threads.** Open items from timeline entries:
   - Items with deadlines in the next 48 hours
   - Follow-ups that are overdue
4. **Recent changes.** Pages updated in the last 24 hours:
   - What changed and why (read timeline entries from gbrain)
5. **People in play.** List person pages in gbrain sorted by recency:
   - Updated in last 7 days
   - Have high activity (many recent timeline entries)
6. **Stale alerts.** From gbrain health check:
   - Pages flagged as stale that are relevant to today's meetings

## Output Format

```
DAILY BRIEFING -- [date]
========================

MEETINGS TODAY
- [time] [meeting name]
  Participants: [name] (slug: people/name, [key context])

ACTIVE DEALS
- [deal name] -- [status], deadline: [date]
  Recent: [latest timeline entry]

ACTION ITEMS
- [item] -- due [date], related to [slug]

RECENT CHANGES (24h)
- [slug] -- [what changed]

PEOPLE IN PLAY
- [name] -- [why they're active]
```

## Tools Used

- Search gbrain by name (query)
- Read a page from gbrain (get_page)
- List pages in gbrain by type (list_pages)
- Check gbrain health (get_health)
- View timeline entries in gbrain (get_timeline)
