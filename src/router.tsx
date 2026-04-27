import { lazy, Suspense } from "react";
import {
  createRouter,
  createRoute,
  createRootRoute,
  redirect,
  Outlet,
} from "@tanstack/react-router";
import { AuthGate } from "@/components/auth/auth-gate";
import { AppLayout } from "@/components/layout/app-layout";
import { AuthenticateWithRedirectCallback } from "@clerk/react";

/* ── Lazy page imports ── */

const McpServerPage = lazy(() => import("./app/(pages)/mcp-server/page"));
const OAuthTestCallbackPage = lazy(
  () => import("./app/(pages)/oauth-test/callback/page"),
);
const OAuthConsentPage = lazy(
  () => import("./app/(pages)/oauth/consent/page"),
);
const ModulesPage = lazy(() => import("./app/(pages)/modules/page"));
const CredentialsPage = lazy(() => import("./app/(pages)/credentials/page"));
const ApiKeysPage = lazy(() => import("./app/(pages)/api-keys/page"));
const OAuthAppsPage = lazy(() => import("./app/(pages)/oauth-apps/page"));

/* ── Route tree ── */

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// Authenticated layout (AuthGate + AppLayout)
const authLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  component: () => (
    <AuthGate>
      <AppLayout>
        <Suspense>
          <Outlet />
        </Suspense>
      </AppLayout>
    </AuthGate>
  ),
});

function lazyRoute(
  path: string,
  Component: React.LazyExoticComponent<React.ComponentType>,
) {
  return createRoute({
    getParentRoute: () => authLayout,
    path,
    component: () => <Component />,
  });
}

const mcpServerRoute = lazyRoute("/mcp-server", McpServerPage);
const modulesRoute = lazyRoute("/modules", ModulesPage);
const credentialsRoute = lazyRoute("/credentials", CredentialsPage);
const apiKeysRoute = lazyRoute("/api-keys", ApiKeysPage);
const oauthAppsRoute = lazyRoute("/oauth-apps", OAuthAppsPage);

// / → /mcp-server
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/mcp-server" as string });
  },
});

// SSO callback (outside auth layout)
const ssoCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sso-callback",
  component: () => <AuthenticateWithRedirectCallback />,
});

// OAuth flow tester popup callback — outside the AuthGate so a fresh
// Clerk login redirect lands here without an mcpist session cookie.
const oauthTestCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/oauth-test/callback",
  component: () => (
    <Suspense>
      <OAuthTestCallbackPage />
    </Suspense>
  ),
});

/**
 * OAuth consent gateway — landing page for /api/v1/oauth/authorize when
 * no Clerk session exists. The page wraps itself in AuthGate (Clerk
 * login screen), then auto-redirects back to the authorize endpoint
 * with the cookie set. No app sidebar / chrome.
 */
const oauthConsentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/oauth/consent",
  component: () => (
    <Suspense>
      <OAuthConsentPage />
    </Suspense>
  ),
});

const routeTree = rootRoute.addChildren([
  authLayout.addChildren([
    mcpServerRoute,
    modulesRoute,
    credentialsRoute,
    apiKeysRoute,
    oauthAppsRoute,
  ]),
  indexRoute,
  ssoCallbackRoute,
  oauthTestCallbackRoute,
  oauthConsentRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
