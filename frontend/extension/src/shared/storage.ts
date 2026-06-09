// Typed wrappers around browser.storage — isolates the browser API boundary.
// Spec: types.ts §ExtensionSettings / LocalState storage schema.

import browser from 'webextension-polyfill';
import { DEFAULT_SETTINGS, DEFAULT_LOCAL_STATE } from './types';
import type { ExtensionSettings, LocalState } from './types';

export async function getSettings(): Promise<ExtensionSettings> {
  // Cast through unknown: storage.get returns Record<string,unknown> but the keys
  // are exactly the DEFAULT_SETTINGS keys, so the cast is safe.
  const stored = await browser.storage.sync.get(DEFAULT_SETTINGS as unknown as Record<string, unknown>);
  return stored as unknown as ExtensionSettings;
}

export async function saveSettings(patch: Partial<ExtensionSettings>): Promise<void> {
  await browser.storage.sync.set(patch as unknown as Record<string, unknown>);
}

export async function getLocalState(): Promise<LocalState> {
  const stored = await browser.storage.local.get(DEFAULT_LOCAL_STATE as unknown as Record<string, unknown>);
  return stored as unknown as LocalState;
}

export async function saveLocalState(patch: Partial<LocalState>): Promise<void> {
  await browser.storage.local.set(patch as unknown as Record<string, unknown>);
}
