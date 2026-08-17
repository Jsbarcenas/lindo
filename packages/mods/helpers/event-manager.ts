import TypedEmitter, { EventMap } from 'typed-emitter'

interface StoredEvent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitter: TypedEmitter<any>
  event: string | number | symbol
  /** el que escribió el mod, y con el que volverá a pedir que se quite */
  listener: (...args: never[]) => void
  /** el que se registró de verdad: el anterior, envuelto */
  guarded: (...args: never[]) => void
}

/**
 * Un listener que no puede escaparse hacia el juego.
 *
 * Estos callbacks los invoca el cliente de Dofus desde su propio bucle, así que
 * una excepción aquí no se queda en casa: sube hasta el `window.onerror` del
 * frame del juego, y ese está sobrescrito por el propio cliente. Su
 * configuración de producción -medida en vivo- manda al servidor de Ankama todo
 * lo que llegue con nivel `error`, junto al `accountId`, al `serverId` y al
 * identificador del aparato. Con la traza incluida.
 *
 * O sea: un mod que peta le manda a Ankama una pila de llamadas con los nombres
 * de los ficheros de Lindo, firmada con la cuenta del jugador. Eso delata
 * bastante más que cualquier user-agent.
 *
 * La construcción de los mods ya estaba protegida en `use-game-manager`, por una
 * razón parecida y anterior: un mod roto no debe llevarse la partida por
 * delante. Esto extiende lo mismo a lo que pasa después, que es donde de verdad
 * se cruza la frontera entre los dos mundos.
 */
export const contain =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <A extends any[]>(listener: (...args: A) => void, event: string | number | symbol = 'dom') =>
  (...args: A) => {
    try {
      listener(...args)
    } catch (error) {
      window.lindoAPI.logger.error(`mod: el listener de "${String(event)}" lanzó`, error)()
    }
  }

export class EventManager {
  private _events: Array<StoredEvent> = []

  on<Events extends EventMap, E extends keyof Events>(emitter: TypedEmitter<Events>, event: E, listener: Events[E]) {
    const guarded = contain(listener, event) as Events[E]
    emitter.on(event, guarded)
    this._events.push({ emitter, event, listener, guarded })
  }

  once<Events extends EventMap, E extends keyof Events>(emitter: TypedEmitter<Events>, event: E, listener: Events[E]) {
    const extendedListener = ((...args: unknown[]) => {
      // removed events from the list after the first call
      this._events = this._events.filter(
        ({ event: event2, listener: listener2 }) => !(event === event2 && listener === listener2)
      )
      listener(...args)
    }) as Events[E]
    const guarded = contain(extendedListener, event) as Events[E]
    emitter.once(event, guarded)
    this._events.push({ emitter, event, listener: extendedListener, guarded })
  }

  /**
   * Quita un listener por el que escribió el mod, no por el que se registró.
   *
   * Quien llama aquí -`shortcuts/mover.ts`- pasa su propia función, y lo que hay
   * enganchado al emisor es el envoltorio. Sin buscar la pareja, `removeListener`
   * se iba sin quitar nada y el listener seguía vivo.
   */
  removeListener<Events extends EventMap, E extends keyof Events>(
    emitter: TypedEmitter<Events>,
    event: E,
    listener: Events[E]
  ) {
    const stored = this._events.find(
      (candidate) => candidate.event === event && (candidate.listener === listener || candidate.guarded === listener)
    )
    emitter.removeListener(event, (stored?.guarded ?? listener) as Events[E])
    this._events = this._events.filter((candidate) => candidate !== stored)
  }

  /**
   * Remove all listener
   */
  close() {
    for (const { emitter, event, guarded } of this._events) {
      emitter.removeListener(event, guarded)
    }
    this._events = []
  }
}
