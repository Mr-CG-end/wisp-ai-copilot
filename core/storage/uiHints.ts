/**
 * UI 引导状态不属于用户设置：它只记录某项能力是否已经被用户实际发现，
 * 因此保持独立裸键，避免扩张 Settings 的三字段契约。
 */
export const SELECTION_DISCOVERY_COMPLETED_KEY = 'selectionDiscoveryCompleted';

export async function isSelectionDiscoveryCompleted(): Promise<boolean> {
  const stored = await chrome.storage.local.get(SELECTION_DISCOVERY_COMPLETED_KEY);
  return stored[SELECTION_DISCOVERY_COMPLETED_KEY] === true;
}

export async function markSelectionDiscoveryCompleted(): Promise<void> {
  await chrome.storage.local.set({ [SELECTION_DISCOVERY_COMPLETED_KEY]: true });
}
