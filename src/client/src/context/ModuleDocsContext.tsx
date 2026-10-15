import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ModuleEntry } from '../registry/modules';
import ModuleHelpDialog from '../components/ModuleHelpDialog';

/**
 * Imperative API for opening the shared module documentation dialog.
 * @interface ModuleDocsApi
 * @property {(module: ModuleEntry) => void} openDocs - Opens the dialog for a module.
 * @property {() => void} closeDocs - Closes the dialog.
 */
interface ModuleDocsApi {
  openDocs: (module: ModuleEntry) => void;
  closeDocs: () => void;
}

const ModuleDocsApiContext = createContext<ModuleDocsApi>({
  openDocs: () => undefined,
  closeDocs: () => undefined,
});

const ModuleDocsStateContext = createContext<ModuleEntry | null>(null);

/**
 * Renders the single documentation dialog instance and re-renders only when
 * the open module changes; host pages consume the stable API context and are
 * never re-rendered by docs navigation.
 * @returns {React.ReactElement} The dialog.
 */
function ModuleDocsDialog(): React.ReactElement {
  const module = useContext(ModuleDocsStateContext);
  const { closeDocs } = useContext(ModuleDocsApiContext);
  return <ModuleHelpDialog module={module} onClose={closeDocs} />;
}

/**
 * Application-level provider owning the one shared module documentation
 * dialog. Keeping the open-module state here (instead of in each host page)
 * means opening, closing, or switching docs never re-renders the page behind
 * the dialog — only this provider's own dialog.
 * @param {object} props - Component props.
 * @param {React.ReactNode} props.children - Application tree.
 * @returns {React.ReactElement} The provider.
 */
export function ModuleDocsProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [module, setModule] = useState<ModuleEntry | null>(null);
  const openDocs = useCallback((entry: ModuleEntry) => setModule(entry), []);
  const closeDocs = useCallback(() => setModule(null), []);
  const api = useMemo(() => ({ openDocs, closeDocs }), [openDocs, closeDocs]);
  return (
    <ModuleDocsApiContext.Provider value={api}>
      <ModuleDocsStateContext.Provider value={module}>
        {children}
        <ModuleDocsDialog />
      </ModuleDocsStateContext.Provider>
    </ModuleDocsApiContext.Provider>
  );
}

/**
 * Accesses the shared docs dialog API. The returned object is referentially
 * stable, so pages holding it never re-render when the dialog opens/closes.
 * @returns {ModuleDocsApi} Stable `{ openDocs, closeDocs }` API.
 */
export function useModuleDocs(): ModuleDocsApi {
  return useContext(ModuleDocsApiContext);
}
