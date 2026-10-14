import { writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const path = 'M0 13a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 16 13V6a1.5 1.5 0 0 0-1.5-1.5h-13A1.5 1.5 0 0 0 0 6zM2 3a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 0-1h-11A.5.5 0 0 0 2 3m2-2a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 0-1h-7A.5.5 0 0 0 4 1'
const svg = (size, ratio) => {
  const glyph = size * ratio
  const offset = (size - glyph) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#0f0f10"/><svg x="${offset}" y="${offset}" width="${glyph}" height="${glyph}" viewBox="0 0 16 16"><path fill="white" d="${path}"/></svg></svg>`
}
writeFileSync('public/icons/favicon.svg', svg(512, .58))
for (const [name, size, ratio] of [
  ['pad-192.png', 192, .58],
  ['pad-512.png', 512, .58],
  ['pad-maskable-512.png', 512, .48],
  ['apple-touch-icon.png', 180, .58],
]) writeFileSync(`public/icons/${name}`, new Resvg(svg(size, ratio)).render().asPng())
