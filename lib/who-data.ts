/**
 * WHO Child Growth Standards — Weight-for-age percentiles
 * Girls: weeks 0–52 | Boys: weeks 0–52
 * Values in grams.
 */

type Centiles = { p3: number; p15: number; p50: number; p85: number; p97: number }

// Girls — weekly data (interpolated from WHO tables)
const WHO_GIRLS: Record<number, Centiles> = {
  0:  { p3: 2400, p15: 2800, p50: 3200, p85: 3700, p97: 4200 },
  1:  { p3: 2500, p15: 2900, p50: 3300, p85: 3900, p97: 4400 },
  2:  { p3: 2700, p15: 3100, p50: 3600, p85: 4100, p97: 4600 },
  3:  { p3: 2900, p15: 3300, p50: 3800, p85: 4400, p97: 5000 },
  4:  { p3: 3100, p15: 3500, p50: 4100, p85: 4700, p97: 5300 },
  5:  { p3: 3300, p15: 3800, p50: 4300, p85: 5000, p97: 5600 },
  6:  { p3: 3500, p15: 4000, p50: 4600, p85: 5300, p97: 5900 },
  7:  { p3: 3700, p15: 4200, p50: 4800, p85: 5500, p97: 6100 },
  8:  { p3: 3900, p15: 4400, p50: 5000, p85: 5700, p97: 6400 },
  9:  { p3: 4100, p15: 4500, p50: 5200, p85: 5900, p97: 6600 },
  10: { p3: 4200, p15: 4700, p50: 5400, p85: 6100, p97: 6800 },
  11: { p3: 4300, p15: 4800, p50: 5500, p85: 6300, p97: 7000 },
  12: { p3: 4500, p15: 5000, p50: 5700, p85: 6500, p97: 7200 },
  13: { p3: 4600, p15: 5100, p50: 5800, p85: 6700, p97: 7400 },
  17: { p3: 5000, p15: 5600, p50: 6400, p85: 7300, p97: 8200 },
  22: { p3: 5400, p15: 6100, p50: 6900, p85: 7800, p97: 8800 },
  26: { p3: 5700, p15: 6500, p50: 7300, p85: 8300, p97: 9300 },
  35: { p3: 6300, p15: 7000, p50: 7900, p85: 9000, p97: 10200 },
  43: { p3: 6700, p15: 7500, p50: 8500, p85: 9600, p97: 10900 },
  52: { p3: 7100, p15: 7900, p50: 8900, p85: 10100, p97: 11500 },
}

// Boys — weekly data (interpolated from WHO tables)
const WHO_BOYS: Record<number, Centiles> = {
  0:  { p3: 2500, p15: 2900, p50: 3400, p85: 3900, p97: 4300 },
  1:  { p3: 2700, p15: 3100, p50: 3600, p85: 4100, p97: 4600 },
  2:  { p3: 2900, p15: 3300, p50: 4000, p85: 4700, p97: 5200 },
  3:  { p3: 3100, p15: 3600, p50: 4300, p85: 5000, p97: 5600 },
  4:  { p3: 3500, p15: 4100, p50: 5000, p85: 5800, p97: 6400 },
  5:  { p3: 3700, p15: 4300, p50: 5200, p85: 6000, p97: 6700 },
  6:  { p3: 3900, p15: 4500, p50: 5400, p85: 6300, p97: 7000 },
  7:  { p3: 4100, p15: 4700, p50: 5600, p85: 6500, p97: 7200 },
  8:  { p3: 4400, p15: 5000, p50: 5900, p85: 6800, p97: 7600 },
  9:  { p3: 4600, p15: 5200, p50: 6200, p85: 7100, p97: 7900 },
  10: { p3: 4700, p15: 5400, p50: 6400, p85: 7400, p97: 8200 },
  11: { p3: 4900, p15: 5600, p50: 6600, p85: 7600, p97: 8500 },
  12: { p3: 5000, p15: 5700, p50: 6800, p85: 7800, p97: 8700 },
  13: { p3: 5200, p15: 5900, p50: 7000, p85: 8000, p97: 8900 },
  17: { p3: 5700, p15: 6500, p50: 7700, p85: 8800, p97: 9900 },
  22: { p3: 6200, p15: 7000, p50: 8200, p85: 9400, p97: 10600 },
  26: { p3: 6600, p15: 7500, p50: 8700, p85: 10000, p97: 11200 },
  35: { p3: 7200, p15: 8100, p50: 9500, p85: 10900, p97: 12300 },
  43: { p3: 7700, p15: 8700, p50: 10100, p85: 11600, p97: 13100 },
  52: { p3: 8200, p15: 9200, p50: 10600, p85: 12200, p97: 13800 },
}

function interpolate(data: Record<number, Centiles>, week: number): Centiles {
  const weeks = Object.keys(data)
    .map(Number)
    .sort((a, b) => a - b)

  if (week <= weeks[0]) return data[weeks[0]]
  if (week >= weeks[weeks.length - 1]) return data[weeks[weeks.length - 1]]

  // Find surrounding weeks
  let lo = weeks[0]
  let hi = weeks[weeks.length - 1]
  for (const w of weeks) {
    if (w <= week) lo = w
    if (w >= week && w < hi) hi = w
  }
  // exact match
  if (lo === week) return data[lo]
  if (hi === week) return data[hi]

  const t = (week - lo) / (hi - lo)
  const a = data[lo]
  const b = data[hi]
  return {
    p3:  Math.round(a.p3  + (b.p3  - a.p3)  * t),
    p15: Math.round(a.p15 + (b.p15 - a.p15) * t),
    p50: Math.round(a.p50 + (b.p50 - a.p50) * t),
    p85: Math.round(a.p85 + (b.p85 - a.p85) * t),
    p97: Math.round(a.p97 + (b.p97 - a.p97) * t),
  }
}

export function getWHOCentiles(weekAge: number, gender: "M" | "F" | null): Centiles {
  const data = gender === "M" ? WHO_BOYS : WHO_GIRLS
  return interpolate(data, Math.max(0, weekAge))
}

export function getPercentileLabel(grams: number, centiles: Centiles): string {
  if (grams < centiles.p3) return "< P3"
  if (grams < centiles.p15) return "P3–P15"
  if (grams < centiles.p50) return "P15–P50"
  if (grams < centiles.p85) return "P50–P85"
  if (grams < centiles.p97) return "P85–P97"
  return "> P97"
}
