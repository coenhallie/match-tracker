/**
 * The names the bundled fonts are registered under (fonts.ts), and drawn in
 * (render/theme.ts). Private, so the widget never picks up, or overrides, a
 * face of the host page's own.
 */
export const LABEL_FAMILY = 'MatchTracker Montserrat'
export const TITLE_FAMILY = 'MatchTracker Inter'

/**
 * After every bundled family: the bundled faces are Latin only, so Chinese
 * text falls through to a system CJK face, and anything else to sans-serif.
 */
export const CJK_FALLBACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'

/** A family list for CSS or a canvas font: the bundled family, then the fallbacks. */
export const familyList = (family: string) => `"${family}", ${CJK_FALLBACK}`
