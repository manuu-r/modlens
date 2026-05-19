import { Hono } from 'hono';
import { list } from '../../server/audit';
import { requireModerator } from '../../server/modAuth';

export const auditApi = new Hono();

auditApi.get('/', async (c) => {
  await requireModerator();
  const limit = Number(c.req.query('limit') ?? 50);
  return c.json({ entries: await list(limit) });
});

auditApi.get('/export', async (c) => {
  await requireModerator();
  const limit = Number(c.req.query('limit') ?? 500);
  const entries = await list(limit);
  if (c.req.query('format') === 'csv') {
    const rows = [
      ['id', 'ts', 'actor', 'action', 'target'],
      ...entries.map((entry) => [
        entry.id,
        String(entry.ts),
        entry.actor,
        entry.action,
        entry.target,
      ]),
    ];
    const csv = rows
      .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(','))
      .join('\n');
    c.header('content-type', 'text/csv; charset=utf-8');
    c.header('content-disposition', 'attachment; filename="modlens-audit.csv"');
    return c.text(csv);
  }
  c.header('content-disposition', 'attachment; filename="modlens-audit.json"');
  return c.json({ entries });
});
