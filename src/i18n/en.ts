import type { TrackerText } from './text'

/**
 * video-annotation's English at 6f14d1f, word for word: the canvas words
 * (goalBanner.ts, freeKick.ts, throwIn.ts, attackIndicator.ts), the HUD's
 * (PipelineOutputSurface.vue's template, PHASE_TEAMS and STATE_TEXT) and the
 * layers menu's (replayLayers.ts). zoomReset is the widget's own: the
 * reference's zoom badge has no tooltip.
 */
export const en: TrackerText = {
  goal: 'GOAL',
  freeKick: 'FREE KICK',
  throwIn: 'THROW IN',
  attack: 'Attack',
  attacking: 'Attacking',
  defending: 'Defending',
  versus: 'vs',
  phaseTooltip:
    'Worked out from the tracking data: a team is attacking once it has kept the ball for 3 seconds, and the other team is then defending.',
  red: 'Red',
  blue: 'Blue',
  layersButton: 'Layers',
  layersTooltip: 'Show or hide what is drawn over the data',
  layersMenuLabel: 'Layers',
  zoomReset: 'Double-click to reset the zoom',
  layers: {
    goal: { label: 'Goal animation', hint: 'A shot into the net on a goal label' },
    attack: { label: 'Attack', hint: 'Worked out from possession: shade and team name' },
    freeKick: { label: 'Free kick', hint: 'A banner on a free kick label, held while play is stopped' },
    throwInBanner: { label: 'Throw-in', hint: "A banner on a throw-in label, sliding in from the ball's half" },
    ballTrail: { label: 'Ball trail', hint: "The ball's path, with a dot at each turn" },
    phaseLabels: { label: 'Attacking / defending', hint: 'Team labels above the pitch' },
    nearbyRings: { label: 'Players near the ball', hint: 'White rings within 15 m of the ball carrier' },
    farFade: { label: 'Fade distant players', hint: 'Players over 15 m from the ball drawn faint' },
    ringFades: { label: 'Smooth ring changes', hint: 'Rings fade in and out instead of snapping' },
  },
}
