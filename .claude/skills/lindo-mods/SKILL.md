---
name: lindo-mods
description: Escribir, modificar o depurar un mod de Lindo (cliente de Dofus Touch en Electron). Cubre la clase Mod, el ciclo de vida, ajustes en el store MST, hotkeys, inyección de DOM/CSS en la iframe del juego, exploración del bundle de Ankama con findSingleton, y el checklist previo al commit. Úsala cuando la tarea toque mods/ o añada una opción o atajo asociado a un mod.
---

# Escribir mods para Lindo

Un mod es una clase que se instancia **una vez por pestaña de juego, después de
seleccionar personaje**, y que manipula el `window` de la iframe donde corre el
cliente de Ankama.

Antes de tocar nada, lee `contexto.md` §3 (pipeline de parcheo) y §6 (mods). Este
documento es el *cómo*.

## Regla que gobierna todo lo demás

> **El código sobre el que operas no es tuyo y cambia sin avisar.**

De ahí salen las tres reglas prácticas:

1. **No caches referencias del juego.** Resuélvelas cuando las uses.
2. **`destroy()` debe dejar el juego exactamente como estaba.** Se llama al
   desconectar y al cerrar pestaña, y el usuario se reconecta muchas veces.
3. **Encadena con `?.`** todo lo que venga de `wGame`. El tipado de
   `packages/dofus-window/` es una promesa optimista, no una
   garantía.

---

## 1. Anatomía

```
packages/mods/mi-mod/
├── mi-mod.ts     la clase
└── index.ts      export * from './mi-mod'
```

Y se registra en `packages/mods/index.ts`:

```ts
import { MiMod } from './mi-mod'
export * from './mi-mod'

export const MODS = [ /* … */, MiMod ] as const
```

> Si el mod es una utilidad general de UI, va en `mods/general/` y se registra en
> `mods/general/index.ts` dentro de `GENERAL_MODS`.

## 2. Plantilla mínima

```ts
import { DofusWindow } from '@/dofus-window'
import { RootStore } from '@/store'
import { TranslationFunctions } from '@lindo/i18n'
import { EventManager } from '../helpers'
import { Mod } from '../mod'

/**
 * One sentence on what the user gets. Comments in this repo are in English and
 * explain *why*, not *what*.
 */
export class MiMod extends Mod {
  private readonly eventManager = new EventManager()

  constructor(wGame: DofusWindow, rootStore: RootStore, LL: TranslationFunctions) {
    super(wGame, rootStore, LL)
    // …
  }

  destroy(): void {
    this.eventManager.close()
  }
}
```

Heredado de `Mod`: `this.wGame` (la `window` del juego), `this.rootStore` (estado
MST) y `this.LL` (traducciones). Lo único obligatorio es `destroy()`.

## 3. El patrón dominante: ajuste ↔ start/stop

La mayoría de los mods se encienden y apagan desde Opciones. Copia esta forma —
es la que usan `hide-shop`, `challenge-percent`, `fight-chronometer`,
`show-resources`:

```ts
export class MiMod extends Mod {
  private readonly eventManager = new EventManager()
  private readonly settingDisposer: () => void

  constructor(wGame: DofusWindow, rootStore: RootStore, LL: TranslationFunctions) {
    super(wGame, rootStore, LL)
    this.settingDisposer = observe(
      this.rootStore.optionStore.gameFight,
      'miAjuste',
      () => {
        if (this.rootStore.optionStore.gameFight.miAjuste) this.start()
        else this.stop()
      },
      true // fireImmediately: aplica el estado inicial al construir
    )
  }

  private start(): void { /* montar */ }
  private stop(): void  { /* desmontar; debe ser idempotente */ }

  destroy(): void {
    this.stop()
    this.settingDisposer()
  }
}
```

Detalles que importan:

- **`fireImmediately: true`** o el mod nace apagado aunque la opción esté activa.
- **`stop()` idempotente**: se llama desde el observer *y* desde `destroy()`.
- **`destroy()` llama a `stop()` Y al disposer.** Olvidar el disposer deja una
  reacción de MobX viva apuntando a una iframe destruida.

## 4. Escuchar eventos del juego

Usa **siempre** `EventManager` (`mods/helpers/event-manager.ts`): acumula los
listeners y los retira todos con `close()`.

```ts
import { ConnectionManagerEvents, GUIEvents, FightManagerEvents } from '@/dofus-window'

// mensajes del protocolo (el catálogo está en dofus-window/dofus/connection-manager.ts)
this.eventManager.on<ConnectionManagerEvents, 'GameFightStartMessage'>(
  this.wGame.dofus.connectionManager, 'GameFightStartMessage', () => this.onFightStart()
)

// eventos de la GUI
this.eventManager.on<GUIEvents, 'resize'>(this.wGame.gui, 'resize', () => this.reposition())

// eventos de combate
this.eventManager.on<FightManagerEvents, 'fightEnd'>(this.wGame.gui.fightManager, 'fightEnd', () => this.reset())
```

Los tres tipos de evento están declarados en `packages/dofus-window/`.
**Si el evento que necesitas no está, añádelo al tipo** en vez de castear a
`any`: el tipado es la única documentación que tenemos del cliente de Ankama.

Para listeners de DOM nativo, `EventManager` no sirve (espera un
`TypedEmitter`). Guarda los disposers en un array propio y vacíalo en
`destroy()`:

```ts
private readonly _disposers: Array<() => void> = []

// …
const onKeyDown = (e: KeyboardEvent) => { /* … */ }
this.wGame.addEventListener('keydown', onKeyDown)
this._disposers.push(() => this.wGame.removeEventListener('keydown', onKeyDown))

destroy(): void {
  this.eventManager.close()
  for (const disposer of this._disposers) disposer()
}
```

## 5. Añadir una opción de usuario

Cuatro sitios, en este orden.

**1 · El modelo MST** — `packages/shared/models/option-store/game-general-option/game-general-option.ts`
(o el submodelo que corresponda: `gameFight`, `gameJob`, `gameGroup`,
`gameNotification`):

```ts
.props({
  miAjuste: types.optional(types.boolean, false)
})
.actions((self) => ({
  setMiAjuste(value: boolean) { self.miAjuste = value }
}))
```

**2 · La UI** — `packages/ui/screens/option-screen/features/OptionGeneralFeatures.tsx`:

```tsx
<FormControl fullWidth>
  <FormControlLabel
    control={<Checkbox />}
    label={LL.option.features.general.miAjuste()}
    checked={optionStore.gameGeneral.miAjuste}
    onChange={(_, checked) => optionStore.gameGeneral.setMiAjuste(checked)}
  />
</FormControl>
```

**3 · Las tres traducciones** — `packages/i18n/{fr,en,es}/index.ts`, en
`option.features.general`. Los tres locales o typesafe-i18n falla el typecheck.

**4 · El mod** lo observa con el patrón de §3.

Después, con `pnpm dev` levantado, typesafe-i18n regenera `packages/i18n/`.
Si no lo tienes levantado: `pnpm --filter @lindo/i18n generate`, y **commitea
la salida regenerada**.

## 6. Añadir un atajo de teclado

Los atajos de mods viven en `hotkeyStore.gameMod`
(`packages/shared/models/hotkey-store/game-mod-hotkey/game-mod-hotkey.ts`):

```ts
.props({ toggleMiMod: types.optional(types.string, '') })
.actions((self) => ({ setToggleMiMod(hotkey: string) { self.toggleMiMod = hotkey } }))
```

UI en `screens/option-screen/shortcuts/OptionShortcuts.tsx`:

```tsx
<ShortcutInput
  id='mi-mod-hotkey'
  label={LL.option.shortcuts.mods.miMod()}
  value={hotkeyStore.gameMod.toggleMiMod}
  onChange={hotkeyStore.gameMod.setToggleMiMod}
/>
```

En el mod, con `LindoShortcuts` (envuelve `shortcuts` y corrige `§`/`²` de los
teclados AZERTY):

```ts
import { LindoShortcuts } from '@/utils'
import { ignoreKeyboardEvent } from '../helpers'

private readonly _shortcuts = new LindoShortcuts({
  target: this.wGame.document,
  shouldHandleEvent: (event) => {
    // no dispares mientras el usuario escribe en el chat
    if (ignoreKeyboardEvent(event)) return false
    return !event.defaultPrevented
  }
})
```

Y **reregístralo cuando el usuario lo cambie** (patrón de `health-bar`):

```ts
const disposer = observe(this.rootStore.hotkeyStore.gameMod, 'toggleMiMod', () => {
  this._shortcuts.reset()
  const shortcut = this.rootStore.hotkeyStore.gameMod.toggleMiMod
  if (!shortcut) return          // '' significa "sin atajo asignado"
  this._shortcuts.add({
    shortcut,
    handler: (e) => { e.preventDefault(); this.toggle(); return true }
  })
}, true)
this._disposers.push(disposer)
```

`return true` en el handler impide que el evento siga propagándose — necesario
cuando el juego también reacciona a esa tecla (p. ej. lanzar un hechizo dos
veces).

`destroy()` debe llamar a `this._shortcuts.reset()`.

## 7. Inyectar DOM y CSS en la iframe

El documento del juego es `this.wGame.document`. **No** `window.document`, que es
el del renderer de React.

```ts
private start(): void {
  this.stylesheet = this.wGame.document.createElement('style')
  this.stylesheet.id = 'miModCss'          // id propio → fácil de encontrar y quitar
  this.stylesheet.innerHTML = `#miModBox { position: absolute; top: 0; }`
  this.wGame.document.head.appendChild(this.stylesheet)

  this.box = this.wGame.document.createElement('div')
  this.box.id = 'miModBox'
  // el contenedor habitual para overlays sobre el mapa: lo usan health-bar,
  // harvest-bar y js-fixes
  this.wGame.foreground.rootElement.appendChild(this.box)
}

private stop(): void {
  this.stylesheet?.remove()
  this.stylesheet = undefined
  this.box?.remove()
  this.box = undefined
}
```

Reglas:

- **Prefija con el nombre del mod** los `id` y las clases que crees. El DOM es
  compartido con el cliente de Ankama.
- **Comprueba si ya existe** antes de crear. Los mods pueden reiniciarse:
  ```ts
  this.initialized = this.wGame.document.querySelector('#miModBox') !== null
  ```
- **`querySelector` puede devolver `null`** aunque el tipo no lo diga. Si Ankama
  renombra una clase, esa es exactamente la línea que lanza.

## 8. Persistir estado del mod

Si el mod necesita recordar algo entre sesiones, va a
`packages/shared/models/mod-store/` (hoy solo está `gripPosition`), **no** a
`localStorage` ni a estado de módulo. Así se replica por IPC y se guarda en
`electron-store` como el resto.

## 9. Explorar el cliente de Ankama

Con el juego abierto, DevTools, y el contexto de ejecución cambiado a la
**iframe del juego** (selector "top" de la consola):

```js
findSingleton('setLook', window)      // busca módulos por propiedad o método
window.gui                            // la GUI completa
window.gui.playerData
window.isoEngine
window.dofus.connectionManager
```

`findSingleton` existe gracias al parche 2 de `regex.json`, que expone
`window.singletons`; lo instala `GameScreen.tsx`. Es la vía práctica para
encontrar el módulo interno que necesitas antes de escribir el mod.

Cuando localices algo que vas a usar, **añádelo al tipado** de
`packages/dofus-window/`, con un comentario explicando qué es si no
resulta evidente. Ejemplo real, de `gui.ts`:

```ts
/**
 * The bars used to live at gui.shortcutBar. They are now owned by a manager
 * that builds one per entity - playerBar for the player, heroBar for a
 * controlled hero - and it is created after the character is selected, so
 * callers have to tolerate it not being there yet.
 */
shortcutBarManager?: { shortcutBars?: { playerBar?: ShortcutBar; heroBar?: ShortcutBar } }
```

## 10. Logging

```ts
window.lindoAPI.logger.info('- enable MiMod')()
window.lindoAPI.logger.error('MiMod failed', error)()
```

**Los paréntesis dobles no son un error.** La primera llamada ya envía el log por
IPC al fichero; devuelve un `console.*` con *bind* aplicado, y la segunda llamada
es la que imprime en DevTools conservando el número de línea real.

Los mods siguen la convención `'- enable NombreDelMod'` al arrancar.

## 11. Errores que ya se cometieron aquí

**Cachear una referencia que el juego reconstruye.** La barra de atajos se movió
de `gui.shortcutBar` a `gui.shortcutBarManager`, se crea *después* de elegir
personaje y se reconstruye al cambiar la entidad controlada. La referencia
capturada en el constructor estaba obsoleta o no existía. La corrección
(`shortcuts.ts`) es resolverla en el momento de la pulsación:

```ts
private _slot(panel: 'spell' | 'item', index: number): Slot | undefined {
  return this.wGame.gui.shortcutBarManager?.shortcutBars?.playerBar?._panels[panel].slotList[index]
}
```

**Dejar que un mod tumbe a los demás.** `startMods()` ya envuelve cada
construcción en `try/catch`, pero eso es una red de seguridad, no una licencia:
un mod que lanza sigue siendo un mod que no funciona, y el usuario no verá ningún
aviso salvo una línea en el log.

**Confundir `window` con `this.wGame`.** Si el CSS no aparece o el listener no
dispara, comprueba primero sobre qué documento estás operando.

## 12. Checklist antes de commitear

```bash
pnpm lint     # typecheck + eslint + hotkeys
pnpm smoke    # la cadena arranca y los mods inicializan
```

Y a mano, porque `smoke` no lo cubre:

- [ ] Arrancar el juego de verdad y usar el mod.
- [ ] **Apagar y encender la opción** varias veces → sin restos, sin duplicados.
- [ ] **Desconectar y reconectar** → `destroy()` limpia; los listeners no se
      acumulan (comprueba que el efecto no se dispara dos veces).
- [ ] **Cerrar la pestaña** con el mod activo → sin errores en consola.
- [ ] Si tocaste i18n: los **tres** locales, y la salida regenerada commiteada.
- [ ] Si tocaste una hotkey: cambiarla en Opciones y verificar que el atajo viejo
      deja de funcionar y el nuevo sí.

## Referencias

Rutas relativas a la raíz del repositorio.

| Para… | Mira |
|---|---|
| mod más simple posible | `packages/mods/general/hide-shop.ts` |
| ajuste + DOM + intervalos | `packages/mods/fight-chronometer/fight-chronometer.ts` |
| CSS inyectado + evento de protocolo | `packages/mods/challenge-percent/challenge-percent.ts` |
| hotkey + estado complejo | `packages/mods/show-resources/show-resources.ts`, `packages/mods/health-bar/` |
| persistencia en `modStore` | `packages/mods/grip-position-save/grip-position-save.ts` |
| resolución tardía de referencias | `packages/mods/shortcuts/shortcuts.ts` |
| ciclo de vida completo | `packages/ui/screens/main-screen/game-screen/use-game-manager.ts` |
| catálogo de eventos | `packages/dofus-window/dofus/connection-manager.ts`, `packages/dofus-window/gui/gui.ts` |
