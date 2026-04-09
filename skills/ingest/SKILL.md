# Ingest Skill

Ingest meetings, articles, documents, and conversations into the brain.

## Workflow

1. **Parse the source.** Extract people, companies, dates, and events from the input.
2. **For each entity mentioned:**
   - Read the entity's page from gbrain to check if it exists
   - If exists: update compiled_truth (rewrite State section with new info, don't append)
   - If new: store the page in gbrain with the appropriate type and slug
3. **Append to timeline.** Add a timeline entry in gbrain for each event, with date, summary, and source.
4. **Create cross-reference links.** Link entities in gbrain for every entity pair mentioned together, using the appropriate relationship type.
5. **Timeline merge.** The same event appears on ALL mentioned entities' timelines. If Alice met Bob at Acme Corp, the event goes on Alice's page, Bob's page, and Acme Corp's page.

## Quality Rules

- Executive summary in compiled_truth must be updated, not just timeline appended
- State section is REWRITTEN, not appended to. Current best understanding only.
- Timeline entries are reverse-chronological (newest first)
- Every person/company mentioned gets a page if one doesn't exist
- Link types: knows, works_at, invested_in, founded, met_at, discussed
- Source attribution: every timeline entry includes the source (meeting, article, email, etc.)

## Tools Used

- Read a page from gbrain (get_page)
- Store/update a page in gbrain (put_page)
- Add a timeline entry in gbrain (add_timeline_entry)
- Link entities in gbrain (add_link)
- List tags for a page (get_tags)
- Tag a page in gbrain (add_tag)
