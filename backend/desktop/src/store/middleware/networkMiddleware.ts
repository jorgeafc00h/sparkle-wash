// Network middleware for handling offline/online state changes

import { Middleware, AnyAction } from '@reduxjs/toolkit';
import { setOnlineStatus, addNotification } from '../slices/appSlice';

export const networkMiddleware: Middleware = (store) => (next) => (action) => {
  const typedAction = action as AnyAction;
  // Handle network state changes
  if (typedAction.type === 'app/checkConnectivity/fulfilled') {
    const { isOnline } = (typedAction as any).payload;
    const wasOffline = !store.getState().app.isOnline;
    
    // If coming back online, trigger sync
    if (wasOffline && isOnline) {
      store.dispatch(addNotification({
        title: 'Back Online',
        message: 'Connection restored. Syncing data...',
        type: 'info',
        read: false,
      }));
      
      // TODO: Trigger sync when sync middleware is implemented
      // store.dispatch(performSync());
    }
  }

  return next(typedAction);
};