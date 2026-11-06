import type { TrackerText } from './text.js'

/**
 * Simplified Chinese. The canvas words, the phase row's words and the team
 * names were given; the rest is a draft for Coen to check before release,
 * the corner's words (角球, and its layer), the throw-in layer's hint, and
 * the player loss's layer and debug badge among them.
 */
export const zh: TrackerText = {
  goal: '进球',
  corner: '角球',
  throwIn: '界外球',
  varCheck: 'VAR 检查',
  goalDisallowed: '进球无效',
  halfTime: '中场休息',
  halfTimeText: '比赛暂停中。\n转播将很快恢复。',
  attack: '进攻',
  attacking: '进攻中',
  defending: '防守中',
  versus: '对',
  phaseTooltip: '根据跟踪数据推算：一支球队控球满 3 秒即为进攻，另一支球队则为防守。',
  phaseAttackingAria: '{team}进攻中',
  phaseDefendingAria: '{team}防守中',
  phaseAria: '{home}，{away}',
  red: '红队',
  blue: '蓝队',
  layersButton: '图层',
  layersTooltip: '显示或隐藏叠加在数据上的内容',
  layersMenuLabel: '图层',
  zoomLevel: '{zoom}x',
  zoomReset: '双击恢复原始大小',
  pitchLabel: '比赛追踪',
  playerLoss: '球员丢失：仅跟踪到 {players} 人',
  playerLossCover: '球员丢失：仅跟踪到 {players} 人，以{team}的进攻覆盖',
  layers: {
    goal: { label: '进球动画', hint: '出现进球标签时，播放射门入网的动画' },
    goalZoom: { label: '球门附近放大', hint: '球接近球门时以及进球时，视角平缓放大' },
    attack: { label: '进攻', hint: '根据控球推算：阴影和球队名称' },
    playerLoss: { label: '球员丢失时显示进攻', hint: '跟踪到的球员少于 18 人时显示进攻动画' },
    corner: { label: '角球', hint: '出现角球标签时显示横幅并点亮角球区，比赛暂停期间一直显示' },
    throwInBanner: { label: '界外球', hint: '出现界外球标签时，在底边线上方显示横幅' },
    varCheck: { label: 'VAR 检查', hint: '出现 VAR 检查标签时，在球场中央显示横幅' },
    goalDisallowed: { label: '进球无效', hint: '出现进球无效标签时，在球场中央显示横幅' },
    halfTime: { label: '中场休息', hint: '出现中场休息标签时，在球场中央显示横幅，直到下一个标签出现' },
    ballTrail: { label: '球的轨迹', hint: '球的移动路线，每次转向处标一个点' },
    phaseLabels: { label: '进攻 / 防守', hint: '球场上方的球队标签' },
    nearbyRings: { label: '持球者附近的球员', hint: '持球球员 15 米内的球员显示白色圆环' },
    farFade: { label: '淡化远处球员', hint: '距球超过 15 米的球员以浅色显示' },
    ringFades: { label: '圆环平滑过渡', hint: '圆环淡入淡出，而不是突然出现或消失' },
  },
}
