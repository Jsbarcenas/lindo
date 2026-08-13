import { requireNativeModule } from 'expo-modules-core'

interface ShellAssets {
  /**
   * Levanta el servidor del shell y devuelve su origen.
   *
   * Idempotente: si ya está en marcha, devuelve el mismo. El puerto lo elige el
   * sistema, así que la URL no se puede saber antes de llamar.
   */
  start: () => Promise<string>
}

export default requireNativeModule<ShellAssets>('ShellAssets')
