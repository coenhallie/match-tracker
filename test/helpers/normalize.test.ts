import { describe, it, expect } from 'vitest'
import { normalizeCalls } from './normalize'

const FALLBACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'

describe('normalizeCalls', () => {
  it('reads a themed Montserrat font as the reference names it', () => {
    const [call] = normalizeCalls([{ font: `600 16px "MatchTracker Montserrat", ${FALLBACK}` }])
    expect(call).toEqual({ font: '600 16px Montserrat, sans-serif' })
  })

  it('reads a themed Inter font as the reference names it', () => {
    const [call] = normalizeCalls([{ font: `italic 900 84.3871px "MatchTracker Inter", ${FALLBACK}` }])
    expect(call).toEqual({ font: 'italic 900 84.3871px Inter, sans-serif' })
  })

  it("leaves the reference's own fonts as they are", () => {
    const fonts = ['600 14px sans-serif', 'bold 10px sans-serif', '700 49.5px Montserrat, sans-serif']
    expect(normalizeCalls(fonts.map((font) => ({ font })))).toEqual(fonts.map((font) => ({ font })))
  })

  it('changes nothing but font values', () => {
    const themed = `600 16px "MatchTracker Montserrat", ${FALLBACK}`
    const call = {
      op: 'fillText',
      font: themed,
      fillStyle: themed,
      textAlign: 'left',
      globalAlpha: 0.5,
      lineDash: [1, 2],
      args: [themed, 20, 700, { font: themed }],
    }
    const [out] = normalizeCalls([call]) as [typeof call]
    expect(out.font).toBe('600 16px Montserrat, sans-serif')
    expect({ ...out, font: themed, args: out.args.slice(0, 3) }).toEqual({ ...call, args: call.args.slice(0, 3) })
    // A font nested anywhere is normalised; the strings around it are not.
    expect(out.args[3]).toEqual({ font: '600 16px Montserrat, sans-serif' })
    // The input is not changed.
    expect(call.font).toBe(themed)
  })
})
