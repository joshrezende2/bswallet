import { useSyncExternalStore } from 'react';
import { getXanoSessionError, getXanoSessionUserId, subscribeXanoSession } from '../data/xano/client';
import { xanoReady } from '../data/xano/config';

export function useXanoSession(userId: string) {
  const owner = useSyncExternalStore(subscribeXanoSession, getXanoSessionUserId);
  const error = useSyncExternalStore(subscribeXanoSession, getXanoSessionError);
  return { connected: xanoReady() && owner === userId, error };
}
