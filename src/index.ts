import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { client } from "./client.js";
import { loadConfig } from "./config.js";

// ---------------------------------------------------------------------------
// RichText handling: detect facets (mentions, links, tags)
// ---------------------------------------------------------------------------

interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: string; [key: string]: unknown }>;
}

function detectFacets(text: string): Facet[] {
  const facets: Facet[] = [];

  // Mentions: @handle.domain
  const mentionRe = /@([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+)/g;
  let match: RegExpExecArray | null;
  while ((match = mentionRe.exec(text)) !== null) {
    facets.push({
      index: { byteStart: match.index, byteEnd: match.index + match[0].length },
      features: [{ $type: "app.bsky.richtext.facet#mention", did: match[1] }],
    });
  }

  // Links
  const linkRe = /(https?:\/\/[^\s]+)/g;
  while ((match = linkRe.exec(text)) !== null) {
    facets.push({
      index: { byteStart: match.index, byteEnd: match.index + match[0].length },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: match[1] }],
    });
  }

  // Tags (hashtags)
  const tagRe = /#[^\s!@#$%^&*()=+./,[{\]};:'"?><]+/g;
  while ((match = tagRe.exec(text)) !== null) {
    facets.push({
      index: { byteStart: match.index, byteEnd: match.index + match[0].length },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: match[0].slice(1) }],
    });
  }

  return facets;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPost(post: Record<string, unknown>): Record<string, unknown> {
  const record = post.record as Record<string, unknown>;
  const author = post.author as Record<string, unknown>;
  return {
    uri: post.uri,
    cid: post.cid,
    text: record?.text,
    createdAt: record?.createdAt,
    author: {
      did: author?.did,
      handle: author?.handle,
      displayName: author?.displayName,
      avatar: author?.avatar,
    },
    likeCount: post.likeCount,
    repostCount: post.repostCount,
    replyCount: post.replyCount,
    indexedAt: post.indexedAt,
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function createServer(): McpServer {
  const server = new McpServer({
    name: "bluesky-mcp",
    version: "1.0.0",
  });

  // ---- Session / Whoami ----

  server.tool(
    "bluesky_whoami",
    "Get the currently authenticated user's DID and handle",
    {},
    async () => {
      const session = await client.getSession();
      return {
        content: [{ type: "text", text: JSON.stringify(session, null, 2) }],
      };
    }
  );

  // ---- Feed Tools ----

  server.tool(
    "bluesky_post",
    "Create a new post on Bluesky. Supports mentions (@handle), links, and hashtags via automatic rich-text facet detection.",
    {
      text: z.string().describe("The text content of the post (max 300 chars for non-multilingual, 300 graphemes)"),
    },
    async ({ text }) => {
      const facets = detectFacets(text);
      const record: Record<string, unknown> = {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
      };

      if (facets.length > 0) {
        record.facets = facets;
      }

      const data = await client.post("com.atproto.repo.createRecord", {
        repo: (await client.getSession()).did,
        collection: "app.bsky.feed.post",
        record,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "bluesky_timeline",
    "Get the home timeline (posts from accounts you follow).",
    {
      limit: z.number().min(1).max(100).default(50).describe("Number of posts (1-100)"),
      cursor: z.string().optional().describe("Pagination cursor for the next page"),
    },
    async ({ limit, cursor }) => {
      const params: Record<string, string | number | boolean | undefined> = { limit };
      if (cursor) params.cursor = cursor;
      const data = await client.get("app.bsky.feed.getTimeline", params);
      const feed = data as { feed?: Array<{ post: Record<string, unknown> }>; cursor?: string };
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            cursor: feed.cursor,
            feed: feed.feed?.map((f) => formatPost(f.post)),
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "bluesky_search",
    "Search for posts on Bluesky by keyword, author, date range, or tags.",
    {
      query: z.string().describe("Search query string"),
      limit: z.number().min(1).max(100).default(25).describe("Number of results (1-100)"),
      cursor: z.string().optional().describe("Pagination cursor"),
      sort: z.enum(["top", "latest"]).default("latest").describe("Sort order"),
      author: z.string().optional().describe("Filter by author handle or DID"),
      since: z.string().optional().describe("ISO date string for lower bound"),
      until: z.string().optional().describe("ISO date string for upper bound"),
    },
    async ({ query, limit, cursor, sort, author, since, until }) => {
      const params: Record<string, string | number | boolean | undefined> = {
        q: query,
        limit,
        sort,
      };
      if (cursor) params.cursor = cursor;
      if (author) params.author = author;
      if (since) params.since = since;
      if (until) params.until = until;

      const data = await client.get("app.bsky.feed.searchPosts", params);
      const result = data as { posts?: Array<Record<string, unknown>>; cursor?: string; hitsTotal?: number };
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            cursor: result.cursor,
            hitsTotal: result.hitsTotal,
            posts: result.posts?.map(formatPost),
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "bluesky_get_post",
    "Get a single post by its AT-URI.",
    {
      uri: z.string().describe("AT-URI of the post (e.g., at://did:plc:xxx/app.bsky.feed.post/rkey)"),
    },
    async ({ uri }) => {
      const match = uri.match(/^at:\/\/(did:[^/]+)\/([^/]+)\/([^/]+)$/);
      if (!match) throw new Error(`Invalid AT-URI: ${uri}`);

      const data = await client.get("app.bsky.feed.getPosts", {
        uris: [uri],
      });
      const result = data as { posts?: Array<Record<string, unknown>> };
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result.posts?.map(formatPost) ?? [], null, 2),
        }],
      };
    }
  );

  server.tool(
    "bluesky_get_thread",
    "Get a post thread (the post with its replies).",
    {
      uri: z.string().describe("AT-URI of the post"),
      depth: z.number().min(0).max(1000).default(6).describe("How many levels of replies to fetch"),
    },
    async ({ uri, depth }) => {
      const data = await client.get("app.bsky.feed.getPostThread", { uri, depth });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "bluesky_get_author_feed",
    "Get posts from a specific author.",
    {
      actor: z.string().describe("Handle or DID of the author"),
      limit: z.number().min(1).max(100).default(30).describe("Number of posts"),
      cursor: z.string().optional().describe("Pagination cursor"),
      filter: z.enum([
        "posts_with_replies",
        "posts_no_replies",
        "posts_with_media",
        "posts_and_author_threads",
        "posts_with_video",
      ]).default("posts_with_replies").describe("What to include"),
    },
    async ({ actor, limit, cursor, filter }) => {
      const params: Record<string, string | number | boolean | undefined> = { actor, limit, filter };
      if (cursor) params.cursor = cursor;
      const data = await client.get("app.bsky.feed.getAuthorFeed", params);
      const feed = data as { feed?: Array<{ post: Record<string, unknown> }>; cursor?: string };
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            cursor: feed.cursor,
            feed: feed.feed?.map((f) => formatPost(f.post)),
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "bluesky_get_likes",
    "Get who liked a post.",
    {
      uri: z.string().describe("AT-URI of the post"),
      limit: z.number().min(1).max(100).default(25).describe("Number of results"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ uri, limit, cursor }) => {
      const params: Record<string, string | number | boolean | undefined> = { uri, limit };
      if (cursor) params.cursor = cursor;
      const data = await client.get("app.bsky.feed.getLikes", params);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ---- Interaction Tools ----

  server.tool(
    "bluesky_like",
    "Like a post.",
    {
      uri: z.string().describe("AT-URI of the post to like"),
      cid: z.string().describe("CID of the post to like"),
    },
    async ({ uri, cid }) => {
      const data = await client.post("com.atproto.repo.createRecord", {
        repo: (await client.getSession()).did,
        collection: "app.bsky.feed.like",
        record: {
          $type: "app.bsky.feed.like",
          subject: { uri, cid },
          createdAt: new Date().toISOString(),
        },
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "bluesky_repost",
    "Repost (retweet) a post.",
    {
      uri: z.string().describe("AT-URI of the post to repost"),
      cid: z.string().describe("CID of the post to repost"),
    },
    async ({ uri, cid }) => {
      const data = await client.post("com.atproto.repo.createRecord", {
        repo: (await client.getSession()).did,
        collection: "app.bsky.feed.repost",
        record: {
          $type: "app.bsky.feed.repost",
          subject: { uri, cid },
          createdAt: new Date().toISOString(),
        },
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "bluesky_delete_post",
    "Delete a post you created.",
    {
      uri: z.string().describe("AT-URI of the post to delete"),
    },
    async ({ uri }) => {
      const match = uri.match(/^at:\/\/(did:[^/]+)\/([^/]+)\/([^/]+)$/);
      if (!match) throw new Error(`Invalid AT-URI: ${uri}`);
      const [, , collection, rkey] = match;

      const data = await client.post("com.atproto.repo.deleteRecord", {
        repo: (await client.getSession()).did,
        collection,
        rkey,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "bluesky_reply",
    "Reply to a post. Creates a reply with proper parent/root references.",
    {
      text: z.string().describe("The reply text content"),
      parentUri: z.string().describe("AT-URI of the post to reply to"),
      parentCid: z.string().describe("CID of the post to reply to"),
      rootUri: z.string().optional().describe("AT-URI of the root post (if replying in thread, defaults to parentUri)"),
      rootCid: z.string().optional().describe("CID of the root post (defaults to parentCid)"),
    },
    async ({ text, parentUri, parentCid, rootUri, rootCid }) => {
      const facets = detectFacets(text);
      const record: Record<string, unknown> = {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
        reply: {
          root: { uri: rootUri ?? parentUri, cid: rootCid ?? parentCid },
          parent: { uri: parentUri, cid: parentCid },
        },
      };

      if (facets.length > 0) {
        record.facets = facets;
      }

      const data = await client.post("com.atproto.repo.createRecord", {
        repo: (await client.getSession()).did,
        collection: "app.bsky.feed.post",
        record,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ---- Actor / Profile Tools ----

  server.tool(
    "bluesky_get_profile",
    "Get a Bluesky user's profile by handle or DID.",
    {
      actor: z.string().describe("Handle (e.g., user.bsky.social) or DID"),
    },
    async ({ actor }) => {
      const data = await client.get("app.bsky.actor.getProfile", { actor });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "bluesky_search_actors",
    "Search for Bluesky users by name or handle.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().min(1).max(100).default(25).describe("Number of results"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ query, limit, cursor }) => {
      const params: Record<string, string | number | boolean | undefined> = { q: query, limit };
      if (cursor) params.cursor = cursor;
      const data = await client.get("app.bsky.actor.searchActors", params);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ---- Graph (Social) Tools ----

  server.tool(
    "bluesky_follow",
    "Follow a Bluesky user.",
    {
      actor: z.string().describe("DID of the user to follow"),
    },
    async ({ actor }) => {
      const data = await client.post("com.atproto.repo.createRecord", {
        repo: (await client.getSession()).did,
        collection: "app.bsky.graph.follow",
        record: {
          $type: "app.bsky.graph.follow",
          subject: actor,
          createdAt: new Date().toISOString(),
        },
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "bluesky_get_followers",
    "Get a user's followers.",
    {
      actor: z.string().describe("Handle or DID of the user"),
      limit: z.number().min(1).max(100).default(30).describe("Number of results"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ actor, limit, cursor }) => {
      const params: Record<string, string | number | boolean | undefined> = { actor, limit };
      if (cursor) params.cursor = cursor;
      const data = await client.get("app.bsky.graph.getFollowers", params);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "bluesky_get_follows",
    "Get who a user follows.",
    {
      actor: z.string().describe("Handle or DID of the user"),
      limit: z.number().min(1).max(100).default(30).describe("Number of results"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ actor, limit, cursor }) => {
      const params: Record<string, string | number | boolean | undefined> = { actor, limit };
      if (cursor) params.cursor = cursor;
      const data = await client.get("app.bsky.graph.getFollows", params);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ---- Notification Tools ----

  server.tool(
    "bluesky_notifications",
    "Get your Bluesky notifications.",
    {
      limit: z.number().min(1).max(100).default(25).describe("Number of notifications"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ limit, cursor }) => {
      const params: Record<string, string | number | boolean | undefined> = { limit };
      if (cursor) params.cursor = cursor;
      const data = await client.get("app.bsky.notification.listNotifications", params);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "bluesky_notification_count",
    "Get count of unread notifications.",
    {},
    async () => {
      const data = await client.get("app.bsky.notification.getUnreadCount");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ---- Resolve ----

  server.tool(
    "bluesky_resolve_handle",
    "Resolve a Bluesky handle to a DID.",
    {
      handle: z.string().describe("Handle to resolve (e.g., user.bsky.social)"),
    },
    async ({ handle }) => {
      const data = await client.get("com.atproto.identity.resolveHandle", { handle });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ---- couchsky · read-only public reads (no login, via the public AppView) ----
  // The "twitter of bluesky" read path (couchsky.app): browse any public
  // profile, feed, or thread without authenticating — separate from the
  // account-scoped tools above, which post/read as the logged-in user.

  server.tool(
    "couchsky_profile",
    "Read ANY public Bluesky profile without logging in — handle, display name, bio, follower/following/post counts. The read-only couchsky.app way.",
    { actor: z.string().describe("Handle (user.bsky.social) or DID") },
    async ({ actor }) => {
      const data = await publicGet("app.bsky.actor.getProfile", { actor });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "couchsky_author_feed",
    "Read ANY user's public posts without logging in — their feed of posts + reposts, newest first. The read-only couchsky.app way.",
    {
      actor: z.string().describe("Handle or DID whose posts to read"),
      limit: z.number().min(1).max(100).default(30).describe("Number of posts (1-100)"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ actor, limit, cursor }) => {
      const data = await publicGet("app.bsky.feed.getAuthorFeed", { actor, limit, cursor });
      const feed = data as { feed?: Array<{ post: Record<string, unknown> }>; cursor?: string };
      return { content: [{ type: "text", text: JSON.stringify({ cursor: feed.cursor, feed: feed.feed?.map((f) => formatPost(f.post)) }, null, 2) }] };
    }
  );

  server.tool(
    "couchsky_thread",
    "Read a public post and its reply thread without logging in, by AT-URI. The read-only couchsky.app way.",
    {
      uri: z.string().describe("AT-URI of the post (at://did/app.bsky.feed.post/rkey)"),
      depth: z.number().min(0).max(100).default(20).describe("Reply depth (0-100)"),
    },
    async ({ uri, depth }) => {
      const data = await publicGet("app.bsky.feed.getPostThread", { uri, depth });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "couchsky_search",
    "Search public Bluesky posts without logging in. The read-only couchsky.app way.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().min(1).max(100).default(25).describe("Number of results (1-100)"),
      sort: z.enum(["top", "latest"]).default("latest").describe("Sort order"),
    },
    async ({ query, limit, sort }) => {
      const data = await publicGet("app.bsky.feed.searchPosts", { q: query, limit, sort });
      const feed = data as { posts?: Array<Record<string, unknown>>; cursor?: string };
      return { content: [{ type: "text", text: JSON.stringify({ cursor: feed.cursor, posts: feed.posts?.map((p) => formatPost(p)) }, null, 2) }] };
    }
  );

  return server;
}

// Public, no-auth reads via the Bluesky AppView — the read-only couchsky.app path.
const PUBLIC_APPVIEW = "https://public.api.bsky.app";
async function publicGet(lex: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  const url = new URL(`${PUBLIC_APPVIEW}/xrpc/${lex}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${lex} failed (${res.status}): ${(data as { message?: string })?.message || res.statusText}`);
  return data;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  try {
    loadConfig();
  } catch (err) {
    console.error((err as Error).message);
    console.error("Set BLUESKY_IDENTIFIER (your handle or email) and BLUESKY_APP_PASSWORD");
    process.exit(1);
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
