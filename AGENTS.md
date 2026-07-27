# AGENTS.md — bluesky-mcp

Guidance for an agent using this server. Read this before you post.

## Two access modes — pick the right one

| | `bluesky_*` (account) | `couchsky_*` (public) |
|---|---|---|
| **Acts as** | the logged-in account | nobody — anonymous read |
| **Auth** | app password required | none |
| **Can write?** | yes (post/like/follow/…) | no, ever |
| **Use for** | doing things *as the user* | reading *anyone's* public data |

**Default to `couchsky_*` for reading.** If you just need to look something up — a
profile, someone's posts, a thread, a search — use the public tools. They need no
credentials, touch no session, and never risk acting as the user. Reserve `bluesky_*`
for reading the user's *own* private surface (home timeline, notifications) or for
writing.

## Writing is a real action — treat it that way

`bluesky_post`, `bluesky_reply`, `bluesky_like`, `bluesky_repost`, `bluesky_follow`,
`bluesky_delete_post` all change the public record under the user's name.

- **Confirm intent before posting** unless the user clearly asked you to post.
- Posts are **≤ 300 graphemes**. Mentions (`@handle`), links, and `#hashtags` are turned
  into rich-text facets automatically — just write natural text.
- A post is hard to unpost. `bluesky_delete_post` exists, but assume anything you post
  was seen.

## Reading — the tools

**Public (no login) — prefer these:**
- `couchsky_profile(actor)` — a profile (bio, counts) for any handle/DID.
- `couchsky_author_feed(actor, limit?)` — anyone's posts, newest first.
- `couchsky_thread(uri, depth?)` — a post and its replies, by AT-URI.
- `couchsky_search(query, limit?, sort?)` — search public posts.

**Account-scoped (needs auth):**
- `bluesky_whoami` — the logged-in DID/handle.
- `bluesky_timeline` — the user's *home* feed (who they follow). Not public.
- `bluesky_notifications` / `bluesky_notification_count` — the user's notifications.
- `bluesky_get_post` · `bluesky_get_thread` · `bluesky_get_author_feed` ·
  `bluesky_get_likes` · `bluesky_get_profile` · `bluesky_search` ·
  `bluesky_search_actors` · `bluesky_get_followers` · `bluesky_get_follows` ·
  `bluesky_resolve_handle` — the same reads, but through the user's session.

## Identifiers

- **Handle:** `alice.bsky.social` — human, may change.
- **DID:** `did:plc:…` — stable, use it when you'll refer to someone repeatedly
  (`bluesky_resolve_handle` turns a handle into a DID).
- **AT-URI:** `at://did:plc:…/app.bsky.feed.post/<rkey>` — a specific post; what
  `couchsky_thread` / `bluesky_get_thread` take.

## Failure is honest

Tools throw a plain error string on failure (auth, rate limit, not-found) — surface it,
don't retry blindly. Missing/invalid credentials fail loudly at startup, never silently.

🜂
