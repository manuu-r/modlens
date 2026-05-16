import { Hono } from 'hono';
import { deleteRule, dryRunRule, getRule, listRules, recentRuleMatches, saveRule } from '../../server/rules';
import { requireModerator } from '../../server/modAuth';
import type { RuleConfig } from '../../shared/types';

export const rulesApi = new Hono();

rulesApi.get('/', async (c) => {
  await requireModerator();
  return c.json(await listRules());
});

rulesApi.post('/', async (c) => {
  await requireModerator();
  const body = await c.req.json<Record<string, unknown>>();
  const rule = (body.rule && typeof body.rule === 'object' ? body.rule : body) as RuleConfig;
  return c.json({ rule: await saveRule(rule) });
});

rulesApi.delete('/:id', async (c) => {
  await requireModerator();
  await deleteRule(c.req.param('id'));
  return c.json({ deleted: true, ok: true });
});

rulesApi.post('/:id/dryrun', async (c) => {
  await requireModerator();
  const body = await c.req.json<Record<string, unknown>>();
  const candidate = body.id ? (body as unknown as RuleConfig) : await getRule(c.req.param('id'));
  if (!candidate) {
    return c.json({ results: [] });
  }
  return c.json({ results: await dryRunRule(candidate, []) });
});

rulesApi.get('/:id/matches', async (c) => {
  await requireModerator();
  const limit = Number(c.req.query('limit') ?? 10);
  return c.json({ items: await recentRuleMatches(c.req.param('id'), limit) });
});
