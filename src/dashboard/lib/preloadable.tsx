import { lazy, useEffect, useState, type ComponentType } from "react";

/** A Suspense fallback for page code still loading: empty, but the startup loader waits on its marker.
 * Code still loading at `deadlineMs` fails into the error boundary above, whose retry waits again. */
export function CodeLoading({ deadlineMs }: { deadlineMs: number }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), deadlineMs);
    return () => clearTimeout(timer);
  }, [deadlineMs]);
  if (expired) throw new Error(`Page code did not load within ${deadlineMs} ms`);
  return <span data-loading-layout="" />;
}

/** A lazy page that renders directly once its code is preloaded: React holds a resolved Suspense boundary
 * for 300 ms after its fallback shows, which would blank every first opening. A mount keeps the form it
 * started with, so a page never remounts when its code arrives; a failed load can be retried. */
export function preloadable<Props extends object>(load: () => Promise<ComponentType<Props>>) {
  let loaded: ComponentType<Props> | undefined;
  let pending: Promise<ComponentType<Props>> | undefined;
  const preload = () => pending ??= load().then(
    component => (loaded = component),
    (error: unknown) => { pending = undefined; throw error; },
  );
  const Lazy = lazy(() => preload().then(component => ({ default: component })));
  function Preloadable(props: Props) {
    const [Shown] = useState<ComponentType<Props> | typeof Lazy>(() => loaded ?? Lazy);
    return <Shown {...props} />;
  }
  return { Component: Preloadable, preload };
}
