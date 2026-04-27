/**
 * Routing primitives — thin wrappers around TanStack Router so component
 * code can keep using Next.js-style names (Link, usePathname, useRouter).
 */

export { Link, redirect } from "@tanstack/react-router";
import {
  useRouter as useTanStackRouter,
  useLocation as useTanStackLocation,
} from "@tanstack/react-router";

/** Returns the current pathname string. */
export function usePathname(): string {
  return useTanStackLocation().pathname;
}

/** useRouter with `push()` for Next.js-style navigation. */
export function useRouter() {
  const router = useTanStackRouter();
  return {
    ...router,
    push: (to: string) => router.navigate({ to }),
  };
}
