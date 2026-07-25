import React, { createContext, useContext, useMemo } from 'react';
import * as Comlink from 'comlink';
import type { InferenceApi } from '../../core/inference/contract';
import { useInference } from './useInference';

export interface InferenceContextValue {
  getApi: () => Comlink.Remote<InferenceApi>;
  recreate: () => void;
}

const InferenceContext = createContext<InferenceContextValue | null>(null);

export const InferenceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const inference = useInference();

  const value = useMemo(
    () => ({
      getApi: inference.getApi,
      recreate: inference.recreate,
    }),
    [inference.getApi, inference.recreate],
  );

  return <InferenceContext.Provider value={value}>{children}</InferenceContext.Provider>;
};

export function useInferenceContext(): InferenceContextValue {
  const ctx = useContext(InferenceContext);
  if (!ctx) {
    throw new Error('useInferenceContext must be used within InferenceProvider');
  }
  return ctx;
}
