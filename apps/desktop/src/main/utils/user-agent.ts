import crypto from 'crypto'
import ElectronStore from 'electron-store'
import { AndroidProfile } from '@lindo/shared'
import { createAndroidProfile, withCurrentChromeVersion } from './android-profile'

interface UserAgentStore {
  /**
   * Superseded by `androidProfile`. Only read to detect an install that still
   * carries one, so the old randomly drawn string can be dropped: a fifth of
   * that pool never resolved to Android, and the value was pinned for up to a
   * year, which is why the platform looked correct on some installs and not on
   * others.
   */
  userAgent?: {
    ua: string
    maxAge: string
  }
  androidProfile: {
    profile: AndroidProfile
    maxAge: string
  }
}

/**
 * The device this install presents itself as, stable across restarts.
 *
 * It is kept for a while rather than redrawn per launch because a client whose
 * device changes between sessions is odd in a way a fixed one is not.
 */
export const getAndroidProfile = async (): Promise<AndroidProfile> => {
  const storage = new ElectronStore<UserAgentStore>()
  const now = new Date()
  const stored = storage.get('androidProfile')

  if (stored && new Date(stored.maxAge) > now) {
    const profile = withCurrentChromeVersion(stored.profile)
    if (profile !== stored.profile) {
      storage.set('androidProfile', { profile, maxAge: stored.maxAge })
    }
    return profile
  }

  const profile = createAndroidProfile()
  const expireDay = crypto.randomInt(10, 360)
  const maxAge = new Date(now.setDate(now.getDate() + expireDay)).toString()

  storage.set('androidProfile', { profile, maxAge })
  // an install upgrading from the old scheme keeps a stale string around that
  // nothing reads anymore
  storage.delete('userAgent')

  return profile
}

export const generateUserArgent = async (appVersion: string) => {
  const profile = await getAndroidProfile()
  return profile.userAgent + ' DofusTouch Client ' + appVersion
}
