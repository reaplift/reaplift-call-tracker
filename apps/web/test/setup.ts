import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Unmount whatever a test rendered, so one test's screen never leaks into the next.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Confirmations say yes unless a test says otherwise; jsdom has no dialog of its own.
window.confirm = () => true;
