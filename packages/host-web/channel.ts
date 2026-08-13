/**
 * The message bus between browsing contexts.
 *
 * Electron relayed MST patches through the main process, which also let a second
 * window - options, unlock - stay in sync. `BroadcastChannel` does the same job
 * between tabs and popups of one origin, and needs no central process at all.
 *
 * The deduplication that made the Electron relay safe is already in
 * `client-store/root-store/setup-root-store.ts`, hashing each patch so an echo
 * is dropped rather than reapplied. It works here unchanged.
 */
export type BusMessage =
  | { type: 'patch'; payload: unknown }
  | { type: 'auto-group'; payload: unknown }
  | { type: 'new-tab' }
  | { type: 'select-tab'; index: number }
  | { type: 'next-tab' }
  | { type: 'prev-tab' }
  | { type: 'close-tab' }
  | { type: 'close-option' }
  | { type: 'select-team'; teamId: string }
  | { type: 'close-unlock' }

const CHANNEL = 'lindo'

let channel: BroadcastChannel | undefined
const channelFor = () => {
  if (!channel) channel = new BroadcastChannel(CHANNEL)
  return channel
}

/** posts to the other contexts; BroadcastChannel never echoes to the sender */
export const publish = (message: BusMessage): void => channelFor().postMessage(message)

export const subscribe = <T extends BusMessage['type']>(
  type: T,
  notify: (message: Extract<BusMessage, { type: T }>) => void
): (() => void) => {
  const listener = (event: MessageEvent<BusMessage>) => {
    if (event.data?.type === type) notify(event.data as Extract<BusMessage, { type: T }>)
  }
  channelFor().addEventListener('message', listener)
  return () => channelFor().removeEventListener('message', listener)
}

/**
 * Same as `subscribe`, but also fires for messages this context sends.
 *
 * The tab shortcuts need it: in Electron the keystroke was caught by the main
 * process and sent back to the window, so the window that had focus reacted to
 * its own keypress. A BroadcastChannel deliberately does not echo, so the local
 * listener has to be invoked directly.
 */
const localListeners = new Map<string, Set<(message: BusMessage) => void>>()

export const publishLocal = (message: BusMessage): void => {
  publish(message)
  localListeners.get(message.type)?.forEach((listener) => listener(message))
}

export const subscribeEverywhere = <T extends BusMessage['type']>(
  type: T,
  notify: (message: Extract<BusMessage, { type: T }>) => void
): (() => void) => {
  const untyped = notify as (message: BusMessage) => void
  if (!localListeners.has(type)) localListeners.set(type, new Set())
  localListeners.get(type)!.add(untyped)
  const unsubscribe = subscribe(type, notify)
  return () => {
    localListeners.get(type)?.delete(untyped)
    unsubscribe()
  }
}
