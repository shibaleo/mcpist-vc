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
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
