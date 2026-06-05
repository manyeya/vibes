import { createContext, useContext } from 'react';

export interface ArtifactsContextValue {
  /** Open the canvas panel focused on the given artifact id. */
  open: (id: string) => void;
  /** The artifact currently shown in the panel, if any. */
  activeId: string | null;
}

export const ArtifactsContext = createContext<ArtifactsContextValue>({
  open: () => {},
  activeId: null,
});

export const useArtifacts = () => useContext(ArtifactsContext);
