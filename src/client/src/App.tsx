import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { StudioThemeProvider } from './theme';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SnackbarProvider } from './context/SnackbarContext';
import { BotProvider } from './context/BotContext';
import { ConnectionsProvider } from './context/ConnectionsContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import BotsOverviewPage from './pages/BotsOverviewPage';
import BotDashboardPage from './pages/BotDashboardPage';
import ModulesManagerPage from './pages/ModulesManagerPage';
import MiniAppsPage from './pages/MiniAppsPage';
import ConnectionSettingsPage from './pages/ConnectionSettingsPage';
import SecurityPage from './pages/SecurityPage';
import ModuleConfigPage from './pages/ModuleConfigPage';
import ConnectionsPage from './pages/ConnectionsPage';
import CrudPage from './components/CrudPage';
import BroadcastPage from './pages/modules/BroadcastPage';
import UsersCrmPage from './pages/modules/UsersCrmPage';
import SupportPage from './pages/modules/SupportPage';
import MonetizationPage from './pages/modules/MonetizationPage';
import WebhooksPage from './pages/modules/WebhooksPage';
import EngagementPage from './pages/modules/EngagementPage';
import ReferralsPage from './pages/modules/ReferralsPage';
import MessageScorePage from './pages/modules/MessageScorePage';
import { useLocalizedModule } from './registry/localize';
import { ErrorBoundary } from './components/ErrorBoundary';
import ScrollToTop from './components/ScrollToTop';

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
    default:
      return <ModuleConfigPage botId={botId} module={module} />;
  }
}

/**
 * Authenticated application routes rendered inside the shared layout.
 * @returns {React.ReactElement} The route tree.
 */
function AppRoutes(): React.ReactElement {
  const { authenticated } = useAuth();

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
 * Application root composing providers and routes.
 * @returns {React.ReactElement} The application.
 */
export default function App(): React.ReactElement {
  return (
    <ErrorBoundary>
      <StudioThemeProvider>
        <AuthProvider>
          <SnackbarProvider>
            <BotProvider>
              <ConnectionsProvider>
                <BrowserRouter>
                  <ScrollToTop />
                  <AppRoutes />
                </BrowserRouter>
              </ConnectionsProvider>
            </BotProvider>
          </SnackbarProvider>
        </AuthProvider>
      </StudioThemeProvider>
    </ErrorBoundary>
  );
}
