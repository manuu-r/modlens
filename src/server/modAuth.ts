import { context, reddit } from '@devvit/web/server';
import { HTTPException } from 'hono/http-exception';

export type ModeratorIdentity = {
  user: string;
  modPerms: string[];
};

export async function requireModerator(): Promise<ModeratorIdentity> {
  const currentUser = await reddit.getCurrentUser();
  const subredditName = context.subredditName;

  if (!currentUser || !subredditName) {
    throw new HTTPException(403, { message: 'Moderator access required.' });
  }

  const modPerms = await currentUser.getModPermissionsForSubreddit(subredditName);
  if (modPerms.length === 0) {
    throw new HTTPException(403, { message: 'Moderator access required.' });
  }

  return {
    user: currentUser.username,
    modPerms: [...modPerms],
  };
}

