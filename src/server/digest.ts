import { context, reddit, redis } from '@devvit/web/server';
import type { DigestWindow, DomainEntry, RecentActivityItem, UserDigest } from '../shared/types';
import { getDomain } from './domains';
import { decode, memo, numberFrom } from './json';
import { normalizeHost, redisKeys } from './redisKeys';

const WINDOW_DAYS: Record<DigestWindow, number> = { '7': 7, '30': 30, '90': 90 };

async function inlineRemovalCount(name: string): Promise<number> {
  const summary = await redis.hGetAll(redisKeys.userSummary(name));
  return numberFrom(summary.removalCount);
}

export async function buildDigest(name: string, window: DigestWindow): Promise<UserDigest> {
  return memo<UserDigest>(`digest:${name}:${window}`, 300, async () => {
    const sinceMs = Date.now() - WINDOW_DAYS[window] * 86_400_000;
    const removalCount = await inlineRemovalCount(name);
    const subreddit = context.subredditName;

    const posts: { url: string; score: number; createdAt: number; removed: boolean }[] = [];
    const comments: { score: number; createdAt: number; removed: boolean }[] = [];
    const domainCounts = new Map<string, number>();

    try {
      const postListing = reddit.getPostsByUser({ username: name, limit: 100, sort: 'new' });
      for (const p of await postListing.all()) {
        const ts = p.createdAt.getTime();
        if (ts < sinceMs) break;
        if (subreddit && p.subredditName !== subreddit) continue;
        posts.push({ url: p.url, score: p.score, createdAt: ts, removed: p.removed });
        const host = normalizeHost(p.url);
        if (host) {
          domainCounts.set(host, (domainCounts.get(host) ?? 0) + 1);
        }
      }
    } catch (error) {
      console.warn('digest: getPostsByUser failed', error);
    }

    try {
      const commentListing = reddit.getCommentsByUser({ username: name, limit: 100, sort: 'new' });
      for (const c of await commentListing.all()) {
        const ts = c.createdAt.getTime();
        if (ts < sinceMs) break;
        if (subreddit && c.subredditName !== subreddit) continue;
        comments.push({ score: c.score, createdAt: ts, removed: c.removed });
      }
    } catch (error) {
      console.warn('digest: getCommentsByUser failed', error);
    }

    const allActivity = [...posts, ...comments];
    const removed = allActivity.filter((a) => a.removed).length;
    const averageScore =
      allActivity.length > 0
        ? Math.round(
            (allActivity.reduce((acc, a) => acc + a.score, 0) / allActivity.length) * 10,
          ) / 10
        : 0;

    const topHosts = [...domainCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([host]) => host);
    const topDomains: DomainEntry[] = [];
    for (const host of topHosts) {
      topDomains.push(await getDomain(host));
    }

    const recentActionIds = await redis.zRange(redisKeys.modlogByUser(name), 0, 2, {
      by: 'rank',
      reverse: true,
    });
    const recentModActions = [] as UserDigest['recentModActions'];
    for (const row of recentActionIds) {
      const raw = await redis.hGet(redisKeys.auditEntry(row.member), 'entry');
      const entry = decode(raw, null) as UserDigest['recentModActions'][number] | null;
      if (entry) recentModActions.push(entry);
    }

    const controversial =
      removalCount >= 3 || (allActivity.length > 0 && removed / allActivity.length > 0.25);

    return {
      window,
      postCount: posts.length,
      commentCount: comments.length,
      removalRatio: allActivity.length === 0 ? 0 : removed / allActivity.length,
      topDomains,
      recentModActions,
      averageScore,
      controversial,
    };
  });
}

export async function buildRecentActivity(name: string, limit = 10): Promise<RecentActivityItem[]> {
  const subreddit = context.subredditName;
  const out: RecentActivityItem[] = [];

  try {
    const posts = await reddit.getPostsByUser({ username: name, limit, sort: 'new' }).get(limit);
    for (const p of posts) {
      if (subreddit && p.subredditName !== subreddit) continue;
      const host = normalizeHost(p.url);
      out.push({
        id: p.id,
        kind: 'post',
        title: p.title,
        url: p.url,
        ...(host ? { domain: host } : {}),
        score: p.score,
        createdAt: p.createdAt.getTime(),
        removed: p.removed,
      });
    }
  } catch (error) {
    console.warn('recentActivity: posts failed', error);
  }

  try {
    const comments = await reddit.getCommentsByUser({ username: name, limit, sort: 'new' }).get(limit);
    for (const c of comments) {
      if (subreddit && c.subredditName !== subreddit) continue;
      out.push({
        id: c.id,
        kind: 'comment',
        body: c.body.slice(0, 240),
        url: c.permalink,
        score: c.score,
        createdAt: c.createdAt.getTime(),
        removed: c.removed,
      });
    }
  } catch (error) {
    console.warn('recentActivity: comments failed', error);
  }

  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}
