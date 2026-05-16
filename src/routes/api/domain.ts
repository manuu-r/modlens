import { Hono } from 'hono';
import { isDomainTag } from '../../shared/tags';
import {
  deleteDomainTag,
  getDomain,
  listSiteAuthors,
  listSiteItems,
  tagDomain,
  topDomains,
} from '../../server/domains';
import { requireModerator } from '../../server/modAuth';

export const domainApi = new Hono();

domainApi.get('/top', async (c) => {
  await requireModerator();
  const limit = Number(c.req.query('limit') ?? 10);
  const rawTag = c.req.query('tag');
  const tag = rawTag && isDomainTag(rawTag) ? rawTag : undefined;
  return c.json({ domains: await topDomains(limit, tag) });
});

domainApi.get('/:host', async (c) => {
  await requireModerator();
  return c.json({ domain: await getDomain(c.req.param('host')) });
});

domainApi.post('/:host/tag', async (c) => {
  const moderator = await requireModerator();
  const body = await c.req.json<Record<string, unknown>>();
  const tag = typeof body.tag === 'string' && isDomainTag(body.tag) ? body.tag : 'watchlist';
  const notes = typeof body.notes === 'string' ? body.notes : typeof body.reason === 'string' ? body.reason : undefined;
  return c.json({
    domain: await tagDomain(c.req.param('host'), { tag, ...(notes ? { notes } : {}) }, moderator.user),
  });
});

domainApi.delete('/:host/tag', async (c) => {
  const moderator = await requireModerator();
  return c.json({ domain: await deleteDomainTag(c.req.param('host'), moderator.user) });
});

domainApi.get('/:host/items', async (c) => {
  await requireModerator();
  const limit = Number(c.req.query('limit') ?? 25);
  return c.json({ items: await listSiteItems(c.req.param('host'), limit) });
});

domainApi.get('/:host/users', async (c) => {
  await requireModerator();
  const limit = Number(c.req.query('limit') ?? 25);
  return c.json({ authors: await listSiteAuthors(c.req.param('host'), limit) });
});
