import { lazy, useState, type ComponentType } from "react";

/** A lazy page that renders directly once its code is preloaded: React holds a resolved Suspense boundary
 * for 300 ms after its fallback shows, which would blank every first opening. A mount keeps the form it
 * started with, so a page never remounts when its code arrives; a failed load can be retried. */
/** A Suspense fallback for page code still loading: empty, but the startup loader waits on its marker. */
export const CodeLoading = () => <span data-loading-layout="" />;

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
