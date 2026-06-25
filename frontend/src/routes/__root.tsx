import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { DottedSurface } from "@/components/ui/dotted-surface";
import appCss from "../styles.css?url";

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

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Polyfy" },
      { name: "description", content: "Convert any 2D photo into a customizable textured 3D polygon model instantly using Polyfy's AI pipeline." },
      { name: "author", content: "Polyfy" },
      { property: "og:title", content: "Polyfy" },
      { property: "og:description", content: "Convert any 2D photo into a customizable textured 3D polygon model instantly using Polyfy's AI pipeline." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "https://mxjkjeforjlgotvdmibm.supabase.co/storage/v1/object/public/inputs/logo.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Orbitron:wght@400;700;900&family=Pacifico&family=Bebas+Neue&family=Space+Mono:wght@400;700&display=swap",
      },
      {
        rel: "preload",
        href: "https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js",
        as: "script",
      },
    ],
    scripts: [
      {
        type: "module",
        src: "https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
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
  return (
    <>
      <DottedSurface />
      <Outlet />
    </>
  );
}
