/**
 * The visuals the replay draws on top of the pipeline's data, each of which
 * can be shown or hidden from the replay's layers menu. Hiding one only stops
 * it being drawn: the data, and what is worked out from it, are unchanged.
 *
 * The choice is kept in the browser, so it holds across videos and visits.
 */

export type ReplayLayerKey =
  | 'goal'
  | 'attack'
  | 'playerLoss'
  | 'corner'
  | 'throwInBanner'
  | 'ballTrail'
  | 'phaseLabels'
  | 'nearbyRings'
  | 'farFade'
  | 'ringFades'

export type ReplayLayers = Record<ReplayLayerKey, boolean>

/**
 * The moments the replay plays over the data. Each plays by itself on its
 * label (or, for an attack, its phase) while its layer is on, and can be
 * played by hand from the demo controls whether or not it is.
 */
export type ReplayMoment = 'goal' | 'attack' | 'corner' | 'throwIn'

/**
 * In the order the menu lists them. Each layer's name and hint are text, in
 * every locale (TrackerText.layers, src/i18n).
 */
export const REPLAY_LAYERS: ReadonlyArray<{ key: ReplayLayerKey }> = [
  { key: 'goal' },
  { key: 'attack' },
  { key: 'playerLoss' },
  { key: 'corner' },
  // Not "throwIn": that was the removed throw-in zoom's key, and a browser
  // that switched it off would hide this without anyone choosing to.
  { key: 'throwInBanner' },
  { key: 'ballTrail' },
  { key: 'phaseLabels' },
  { key: 'nearbyRings' },
  { key: 'farFade' },
  { key: 'ringFades' },
]

export const DEFAULT_REPLAY_LAYERS: ReplayLayers = {
  goal: true,
  attack: true,
  playerLoss: true,
  corner: true,
  throwInBanner: true,
  ballTrail: true,
  phaseLabels: true,
  nearbyRings: true,
  farFade: true,
  ringFades: true,
}

const STORAGE_KEY = 'perspecto.replayLayers'

/**
 * The stored choice, over the defaults. Anything stored that is not a known
 * layer set to true or false is ignored, so an entry from another version, or
 * a damaged one, never hides a layer nobody chose to hide.
 */
export function readReplayLayers(storage: Pick<Storage, 'getItem'> | null): ReplayLayers {
  const layers = { ...DEFAULT_REPLAY_LAYERS }
  try {
    const stored: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null')
    if (stored && typeof stored === 'object') {
      for (const key of Object.keys(layers) as ReplayLayerKey[]) {
        const value = (stored as Record<string, unknown>)[key]
        if (typeof value === 'boolean') layers[key] = value
      }
    }
  } catch {
    // Unreadable or refused: the defaults stand.
  }
  return layers
}

/** Keep the choice; a browser that refuses storage just does not remember it. */
export function writeReplayLayers(storage: Pick<Storage, 'setItem'> | null, layers: ReplayLayers): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(layers))
  } catch {
    // Private mode or full: the choice lasts for this visit only.
  }
}
