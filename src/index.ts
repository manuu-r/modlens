import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { Hono } from 'hono';
import { auditApi } from './routes/api/audit';
import { alertsApi } from './routes/api/alerts';
import { aiApi } from './routes/api/ai';
import { bootstrapApi } from './routes/api/bootstrap';
import { domainApi } from './routes/api/domain';
import { itemApi } from './routes/api/item';
import { modlogApi } from './routes/api/modlog';
import { presenceApi } from './routes/api/presence';
import { removalReasonsApi } from './routes/api/removalReasons';
import { rulesApi } from './routes/api/rules';
import { triageApi } from './routes/api/triage';
import { userApi } from './routes/api/user';
import { cron } from './routes/cron';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { settingsRoutes } from './routes/settings';
import { triggers } from './routes/triggers';

const app = new Hono();
const api = new Hono();
const internal = new Hono();

api.route('/bootstrap', bootstrapApi);
api.route('/ai', aiApi);
api.route('/user', userApi);
api.route('/item', itemApi);
api.route('/domain', domainApi);
api.route('/triage', triageApi);
api.route('/modlog', modlogApi);
api.route('/rules', rulesApi);
api.route('/alerts', alertsApi);
api.route('/audit', auditApi);
api.route('/removal-reasons', removalReasonsApi);
api.route('/presence', presenceApi);

internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);
internal.route('/cron', cron);
internal.route('/scheduler', cron);
internal.route('/settings', settingsRoutes);

app.route('/api', api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
