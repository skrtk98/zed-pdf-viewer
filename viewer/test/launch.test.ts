import { describe, expect, it } from 'vitest';
import { isRemoteSession } from '../src/launch';

describe('isRemoteSession', () => {
  it('detects any of the SSH variables', () => {
    expect(isRemoteSession({ SSH_CONNECTION: '1 2 3 4' })).toBe(true);
    expect(isRemoteSession({ SSH_TTY: '/dev/pts/0' })).toBe(true);
    expect(isRemoteSession({ SSH_CLIENT: '1 2 3' })).toBe(true);
  });
  it('treats other environments as local', () => {
    expect(isRemoteSession({})).toBe(false);
    expect(isRemoteSession({ SSH_CONNECTION: '' })).toBe(false);
  });
});
