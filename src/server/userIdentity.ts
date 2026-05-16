import { reddit } from '@devvit/web/server';
import { isT2, type T2 } from '@devvit/shared-types/tid.js';

export function normalizeUsernameInput(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^u\//i, '');
}

export function canOpenAuthorContext(value: string | null | undefined): boolean {
  const name = normalizeUsernameInput(value);
  return Boolean(
    name &&
      name !== '[deleted]' &&
      name.toLowerCase() !== 'undefined' &&
      name.toLowerCase() !== 'null' &&
      !name.includes('{') &&
      !name.includes('}') &&
      !/^t[1-6]_/.test(name)
  );
}

export async function resolveRedditUsername(
  value: string | null | undefined,
  accountId?: string | null
): Promise<string> {
  const normalized = normalizeUsernameInput(value);
  if (canOpenAuthorContext(normalized)) {
    return normalized;
  }

  const candidateId = isT2(normalized) ? normalized : isT2(accountId) ? accountId : undefined;
  if (candidateId) {
    try {
      const user = await reddit.getUserById(candidateId as T2);
      if (user?.username) {
        return user.username;
      }
    } catch (error) {
      console.warn('resolveRedditUsername: getUserById failed', error);
    }
  }

  return normalized;
}
