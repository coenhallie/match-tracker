import type { TrackerText } from './text'

/**
 * Simplified Chinese. The canvas words, the phase row's words and the team
 * names were given; the rest is a draft for Coen to check before release.
 */
export const zh: TrackerText = {
  goal: '进球',
  freeKick: '任意球',
  throwIn: '界外球',
  attack: '进攻',
  attacking: '进攻中',
  defending: '防守中',
  versus: '对',
  phaseTooltip: '根据跟踪数据推算：一支球队控球满 3 秒即为进攻，另一支球队则为防守。',
  red: '红队',
  blue: '蓝队',
  layersButton: '图层',
  layersTooltip: '显示或隐藏叠加在数据上的内容',
  layersMenuLabel: '图层',
  zoomReset: '双击恢复原始大小',
  layers: {
    goal: { label: '进球动画', hint: '出现进球标签时，播放射门入网的动画' },
    attack: { label: '进攻', hint: '根据控球推算：阴影和球队名称' },
    freeKick: { label: '任意球', hint: '出现任意球标签时显示横幅，比赛暂停期间一直显示' },
    throwInBanner: { label: '界外球', hint: '出现界外球标签时显示横幅，从球所在的半场滑入' },
    ballTrail: { label: '球的轨迹', hint: '球的移动路线，每次转向处标一个点' },
    phaseLabels: { label: '进攻 / 防守', hint: '球场上方的球队标签' },
    nearbyRings: { label: '持球者附近的球员', hint: '持球球员 15 米内的球员显示白色圆环' },
    farFade: { label: '淡化远处球员', hint: '距球超过 15 米的球员以浅色显示' },
    ringFades: { label: '圆环平滑过渡', hint: '圆环淡入淡出，而不是突然出现或消失' },
  },
}
