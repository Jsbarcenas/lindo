/**
 * Capabilities injected into the store at creation time, via the mobx-state-tree
 * environment (`RootStoreModel.create(snapshot, env)`).
 *
 * The same store model is instantiated in the main process and in every renderer,
 * but some actions can only run on one side. Declaring those capabilities here
 * keeps the shared models free of process-specific globals.
 */
export interface RootStoreEnv {
  /**
   * Encrypts a character password. Renderer only: the encryption happens in the
   * main process and is reached over IPC through the preload bridge.
   */
  encryptCharacterPassword?: (characterPassword: string) => Promise<string>
}
