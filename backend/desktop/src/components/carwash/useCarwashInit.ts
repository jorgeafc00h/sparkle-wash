// Loads carwash settings/session/cache and starts sync once per app run
// (the first screen that needs carwash data triggers it).

import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { initCarwash, selectCarwash } from '@/store/slices/carwashSlice';

let started = false;

export function useCarwashInit(): void {
  const dispatch = useAppDispatch();
  const initialized = useAppSelector((s) => selectCarwash(s).initialized);
  useEffect(() => {
    if (initialized || started) return;
    started = true;
    void dispatch(initCarwash());
  }, [dispatch, initialized]);
}
