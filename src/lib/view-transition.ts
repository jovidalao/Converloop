/**
 * Switch the main view/route. Native desktop apps use a direct cut between views — no route-level crossfade
 * (that's a web habit and one of the first tells that something is a web app). The state update is therefore
 * executed synchronously without wrapping it in View Transitions. The thin wrapper is kept for call-site clarity
 * and to provide a single entry point if a named-element morph transition is ever added. The second parameter
 * is preserved for backward compatibility and is currently ignored.
 */
export function withViewTransition(update: () => void, _marker?: string): void {
  update();
}
