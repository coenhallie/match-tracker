import type { TrackerText } from './text.js'

/**
 * video-annotation's English at 6f14d1f, word for word: the canvas words
 * (goalBanner.ts, throwIn.ts, attackIndicator.ts), the HUD's
 * (PipelineOutputSurface.vue's template, PHASE_TEAMS and STATE_TEXT) and the
 * layers menu's (replayLayers.ts). The phase row's ARIA templates give the
 * reference's `phaseDescription` ("Red attacking, Blue defending"), which
 * lowercases the state words into it. zoomReset and pitchLabel are the
 * widget's own: the reference has no tooltip for the zoom, and no label on
 * its canvas. The corner's words, on its card and in the layers menu, are the
 * widget's own too: the reference has no corner. So is the throw-in layer's
 * hint, as the widget's throw-in fades in where the reference's slides, and
 * so are the player loss's layer and debug badge. So are the label cards'
 * words, on the card and in the layers menu.
 */
export const en: TrackerText = {
  goal: 'GOAL',
  corner: 'CORNER',
  throwIn: 'THROW IN',
  varCheck: 'VAR CHECK',
  goalDisallowed: 'GOAL DISALLOWED',
  halfTime: 'HALF TIME',
  halfTimeText: 'There is a break in play.\nCoverage will resume soon.',
  attack: 'Attack',
  attacking: 'Attacking',
  defending: 'Defending',
  versus: 'vs',
  phaseTooltip:
    'Worked out from the tracking data: a team is attacking once it has kept the ball for 3 seconds, and the other team is then defending.',
  phaseAttackingAria: '{team} attacking',
  phaseDefendingAria: '{team} defending',
  phaseAria: '{home}, {away}',
  red: 'Red',
  blue: 'Blue',
  layersButton: 'Layers',
  layersTooltip: 'Show or hide what is drawn over the data',
  layersMenuLabel: 'Layers',
  zoomLevel: '{zoom}x',
  zoomReset: 'Double-click to reset the zoom',
  pitchLabel: 'Match tracker',
  playerLoss: 'Player loss: {players} tracked',
  playerLossCover: "Player loss: {players} tracked, covered by {team}'s attack",
  layers: {
    goal: { label: 'Goal animation', hint: 'A shot into the net on a goal label' },
    goalZoom: { label: 'Zoom near goal', hint: 'The view eases in as the ball nears a goal, and into a goal' },
    attack: { label: 'Attack', hint: 'Worked out from possession: shade and team name' },
    playerLoss: { label: 'Attack over lost players', hint: 'An attack while fewer than 18 players are tracked' },
    corner: { label: 'Corner', hint: 'A banner and the corner lit up on a corner label, held while play is stopped' },
    throwInBanner: { label: 'Throw-in', hint: 'A banner along the bottom touchline on a throw-in label' },
    varCheck: { label: 'VAR check', hint: 'A banner across the middle of the pitch on a VAR check label' },
    goalDisallowed: { label: 'Goal disallowed', hint: 'A banner across the middle of the pitch on a goal disallowed label' },
    halfTime: { label: 'Half time', hint: 'A banner across the middle of the pitch on a half time label, until the next label' },
    ballTrail: { label: 'Ball trail', hint: "The ball's path, with a dot at each turn" },
    phaseLabels: { label: 'Attacking / defending', hint: 'Team labels above the pitch' },
    nearbyRings: { label: 'Players near the ball', hint: 'White rings within 15 m of the ball carrier' },
    farFade: { label: 'Fade distant players', hint: 'Players over 15 m from the ball drawn faint' },
    ringFades: { label: 'Smooth ring changes', hint: 'Rings fade in and out instead of snapping' },
  },
}
