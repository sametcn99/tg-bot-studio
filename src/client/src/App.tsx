import React, { Suspense, lazy } from 'react';
import {
  createBrowserRouter,
  Navigate,
  Route,
  RouterProvider,
  Routes,
  useParams,
} from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { StudioThemeProvider } from './theme';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SnackbarProvider } from './context/SnackbarContext';
import { BotProvider } from './context/BotContext';
import { ConnectionsProvider } from './context/ConnectionsContext';
import { ModuleDocsProvider } from './context/ModuleDocsContext';
import { useLocalizedModule } from './registry/localize';
import { ErrorBoundary } from './components/ErrorBoundary';
import ScrollToTop from './components/ScrollToTop';

// Route-level code splitting: every page is its own chunk, loaded on first
// navigation instead of up front.
const Layout = lazy(() => import('./components/Layout'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const BotsOverviewPage = lazy(() => import('./pages/BotsOverviewPage'));
const BotDashboardPage = lazy(() => import('./pages/BotDashboardPage'));
const ModulesManagerPage = lazy(() => import('./pages/ModulesManagerPage'));
const MiniAppsPage = lazy(() => import('./pages/MiniAppsPage'));
const ConnectionSettingsPage = lazy(() => import('./pages/ConnectionSettingsPage'));
const SecurityPage = lazy(() => import('./pages/SecurityPage'));
const ModuleConfigPage = lazy(() => import('./pages/ModuleConfigPage'));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage'));
const CrudPage = lazy(() => import('./components/CrudPage'));
const BroadcastPage = lazy(() => import('./pages/modules/BroadcastPage'));
const UsersCrmPage = lazy(() => import('./pages/modules/UsersCrmPage'));
const SupportPage = lazy(() => import('./pages/modules/SupportPage'));
const MonetizationPage = lazy(() => import('./pages/modules/MonetizationPage'));
const WebhooksPage = lazy(() => import('./pages/modules/WebhooksPage'));
const EngagementPage = lazy(() => import('./pages/modules/EngagementPage'));
const ReferralsPage = lazy(() => import('./pages/modules/ReferralsPage'));
const MessageScorePage = lazy(() => import('./pages/modules/MessageScorePage'));
const MediaLibraryPage = lazy(() => import('./pages/modules/MediaLibraryPage'));
const InlineModePage = lazy(() => import('./pages/modules/InlineModePage'));
const FlowBuilderPage = lazy(() => import('./pages/modules/FlowBuilderPage'));

/**
 * Centered spinner shown while a lazily loaded route chunk is downloading.
 * @returns {React.ReactElement} The Suspense fallback.
 */
function RouteFallback(): React.ReactElement {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 10 }}
    >
      <CircularProgress size={32} />
    </Box>
  );
}

/**
 * Dispatches a module route to the matching dashboard page component based
 * on the registry page type.
 * @param {object} props - Component props.
 * @param {number} props.botId - Active bot id.
 * @param {string} props.moduleKey - Module registry key.
 * @returns {React.ReactElement | null} The rendered module page.
 */
function ModulePageDispatcher({
  botId,
  moduleKey,
}: {
  botId: number;
  moduleKey: string;
}): React.ReactElement | null {
  const module = useLocalizedModule(moduleKey);
  if (!module) return null;

  switch (module.pageType) {
    case 'config':
      return <ModuleConfigPage botId={botId} module={module} />;
    case 'crud':
      return module.crud ? (
        <CrudPage botId={botId} module={module} />
      ) : (
        <ModuleConfigPage botId={botId} module={module} />
      );
    case 'broadcast':
      return <BroadcastPage botId={botId} module={module} />;
    case 'crm':
      return <UsersCrmPage botId={botId} module={module} />;
    case 'support':
      return <SupportPage botId={botId} module={module} />;
    case 'monetization':
      return <MonetizationPage botId={botId} module={module} />;
    case 'webhooks':
      return <WebhooksPage botId={botId} module={module} />;
    case 'engagement':
      return <EngagementPage botId={botId} module={module} />;
    case 'referrals':
      return <ReferralsPage botId={botId} module={module} />;
    case 'connections':
      return <ConnectionsPage botId={botId} module={module} />;
    case 'message-score':
      return <MessageScorePage botId={botId} module={module} />;
    case 'media-library':
      return <MediaLibraryPage botId={botId} module={module} />;
    case 'inline':
      return <InlineModePage botId={botId} module={module} />;
    case 'flows':
      return <FlowBuilderPage botId={botId} module={module} />;
    default:
      return <ModuleConfigPage botId={botId} module={module} />;
  }
}

/**
 * Authenticated application routes rendered inside the shared layout.
 * @returns {React.ReactElement} The route tree.
 */
function AppRoutes(): React.ReactElement {
  const { authenticated, checking } = useAuth();

  if (checking) {
    return <RouteFallback />;
  }

  if (!authenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<BotsOverviewPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/bots/:botId" element={<BotDashboardPage />} />
        <Route path="/bots/:botId/modules" element={<ModulesManagerPage />} />
        <Route path="/bots/:botId/mini-apps" element={<MiniAppsPage />} />
        <Route
          path="/bots/:botId/connections/:connectionId/settings"
          element={<ConnectionSettingsPage />}
        />
        <Route path="/bots/:botId/m/:moduleKey" element={<ModuleRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * Route wrapper extracting path parameters for module pages.
 * @returns {React.ReactElement | null} The dispatched module page.
 */
function ModuleRoute(): React.ReactElement | null {
  const { botId, moduleKey } = useParams<{ botId: string; moduleKey: string }>();
  return <ModulePageDispatcher botId={Number(botId)} moduleKey={moduleKey ?? ''} />;
}

/**
 * Data router (required by `useBlocker` guards) — the whole route tree hangs
 * off a single catch-all element so the declarative <Routes> markup and the
 * auth gate keep working unchanged.
 */
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <Suspense fallback={<RouteFallback />}>
        <ScrollToTop />
        <AppRoutes />
      </Suspense>
    ),
  },
]);

/**
 * Application root composing providers and routes.
 * @returns {React.ReactElement} The application.
 */
export default function App(): React.ReactElement {
  return (
    <ErrorBoundary>
      <StudioThemeProvider>
        <ModuleDocsProvider>
          <AuthProvider>
            <SnackbarProvider>
              <BotProvider>
                <ConnectionsProvider>
                  <RouterProvider router={router} />
                </ConnectionsProvider>
              </BotProvider>
            </SnackbarProvider>
          </AuthProvider>
        </ModuleDocsProvider>
      </StudioThemeProvider>
    </ErrorBoundary>
  );
}
