import { describe, expect, it } from 'vitest';
import { addedExternalHosts, hostsFromText, textFromThingRecord } from '../src/server/linkDiff';

describe('edited link detection', () => {
  it('detects links added to a post body after approval or prior triage removal', () => {
    expect(
      addedExternalHosts('clean approved text', 'clean approved text\nhttps://scam-example.com/path'),
    ).toEqual(['scam-example.com']);
  });

  it('does not re-flag links already present before the edit', () => {
    expect(
      addedExternalHosts(
        'already here https://scam-example.com/path',
        'already here https://scam-example.com/path plus more text',
      ),
    ).toEqual([]);
  });

  it('detects bare domains and ignores Reddit hosts', () => {
    expect(hostsFromText('visit scam-example.com and https://reddit.com/r/test')).toEqual(
      new Set(['scam-example.com']),
    );
  });

  it('reads Devvit post/comment body fields', () => {
    expect(textFromThingRecord({ selftext: 'post body' })).toBe('post body');
    expect(textFromThingRecord({ body: 'comment body' })).toBe('comment body');
  });
});
