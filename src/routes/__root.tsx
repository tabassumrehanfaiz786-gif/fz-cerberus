import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { CarryProvider } from '@/components/cerberus/CarryProvider';
import { useCarry } from '@/components/cerberus/CarryProvider';

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Cerberus — Market Surveillance & Paper Carry" },
      { name: "description", content: "Public market surveillance and live-data cash-and-carry paper research." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Cerberus — Market Surveillance & Paper Carry" },
      { property: "og:description", content: "Live crypto market research, carry screening and simulated hedging." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <CarryProvider>
      <TerminalNavigation />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      </CarryProvider>
    </QueryClientProvider>
  );
}

const STATIONS = [
  { to: '/', label: 'Surveillance', tag: 'LIVE BOOK', c: 'border-mm/60 bg-mm/10 text-mm', a: 'bg-mm text-background border-mm' },
  { to: '/screener', label: '50-Asset Screener', tag: 'TOP 50', c: 'border-perp/60 bg-perp/10 text-perp', a: 'bg-perp text-background border-perp' },
  { to: '/desk', label: 'Hedge Desk', tag: 'PAPER BOT', c: 'border-bid/60 bg-bid/10 text-bid', a: 'bg-bid text-background border-bid' },
] as const;

function TerminalNavigation() {
  const b = useCarry();
  return (
    <nav aria-label="Terminal navigation" className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-3 py-2 font-mono">
      <span className="mr-2 text-sm font-bold text-foreground">CERBERUS<span className="text-mm"> ▲</span></span>
      {STATIONS.map(s => (
        <Link key={s.to} to={s.to} activeOptions={{ exact: true }}
          className={`flex items-center gap-2 border px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 ${s.c}`}
          activeProps={{ className: s.a }}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          {s.label}
          <span className="text-[9px] opacity-70">{s.tag}</span>
        </Link>
      ))}
      <span className="ml-auto py-1 text-[10px] text-muted-foreground">PAPER ONLY · {b?.enabled ? `${b.positions.length} HEDGES ACTIVE` : 'NO REAL ORDERS'}</span>
    </nav>
  );
}
