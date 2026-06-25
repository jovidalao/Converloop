// Tiny in-process event bus between the data layer and panels that mirror it.
// Observer annotations, write proposals, and input hints are committed to the DB
// asynchronously (after the turn persists); instead of panels polling on a timer,
// the writers emit an event here and subscribers refetch once. Module-level (not
// window events) so non-DOM code and tests can use it directly.

interface AppEventPayloads {
  /** A turn_annotation or memory_proposal row was written/updated. */
  "coach-data-changed": { turnId?: string };
  /** Input hints for a conversation were (re)generated and cached. */
  "input-hints-changed": { conversationId: string };
  /** Request a turn to open a specific in-bubble panel (coach focus card → detail).
   * The owning turn matches by `${turnId}:` prefix on the panelId. */
  "panel-command": { panelId: string };
}

export type AppEventName = keyof AppEventPayloads;

type Listener<E extends AppEventName> = (payload: AppEventPayloads[E]) => void;

const listeners = new Map<AppEventName, Set<Listener<AppEventName>>>();

export function onAppEvent<E extends AppEventName>(
  event: E,
  listener: Listener<E>,
): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(listener as Listener<AppEventName>);
  return () => {
    set.delete(listener as Listener<AppEventName>);
  };
}

export function emitAppEvent<E extends AppEventName>(
  event: E,
  payload: AppEventPayloads[E],
): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const listener of [...set]) {
    try {
      listener(payload);
    } catch {
      // A broken subscriber must not break the writer (emits happen on the data path).
    }
  }
}
