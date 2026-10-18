import Link from 'next/link';

/**
 * Static 404 — GitHub Pages serves this file for any unknown path on the
 * site. The app itself is a single route, so the kindest thing is a short
 * branded note plus an automatic redirect back to the app.
 */
export default function NotFound() {
  // Root deployments ('' → '/'), GitHub Pages ('/Notes-printifier' → '/Notes-printifier/').
  const home = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/`;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 py-16 text-center text-foreground">
      <meta httpEquiv="refresh" content={`3;url=${home}`} />
      <p aria-hidden="true" className="text-7xl font-black tracking-tighter text-violet-400">
        404
      </p>
      <h1 className="text-xl font-bold">Page not found</h1>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        The Printifier app lives at a single address — taking you back in a few
        seconds.
      </p>
      <Link
        href="/"
        className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/10"
      >
        ← Back to Printifier
      </Link>
    </main>
  );
}
