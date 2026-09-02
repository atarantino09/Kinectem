---
name: Unclaimed organization deletion
description: Safety rules for permanently deleting ownerless organization pages and their dependent records.
---

Permanently deleting an unclaimed organization must lock each organization row before checking for an owner, then keep that lock through deletion. The final owner check cannot rely on an earlier list response or an unlocked preflight.

**Why:** An organization can be claimed while a destructive confirmation dialog is open. Locking the parent row serializes the owner's foreign-key insert with deletion, so a claim that wins first is protected and a later claim cannot attach to a row already committed for deletion.

**How to apply:** Use this rule for every admin cleanup path that can remove ownerless organizations, whether scoped by selected IDs or a named list.

Organization and team foreign-key cascades are not enough for post activity. Polymorphic tables keyed by a kind plus an unguarded UUID have no foreign key to articles, highlights, organization posts, news links, or comments and must be purged explicitly before their targets disappear.

**Why:** Cascading the organization removes real foreign-key descendants but otherwise leaves reactions, shares, comments, albums, takedowns, and reports pointing at nonexistent content. Comment reports require special ordering because their target comments are themselves polymorphic children.

**How to apply:** Derive all doomed post IDs, delete reports on doomed comments before deleting the comments, remove the remaining polymorphic activity, and only then delete the organization rows.