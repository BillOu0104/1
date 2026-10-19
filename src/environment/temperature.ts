import type { Body } from '../physics/types';
import { AU_METERS } from '../physics/parameters';
import { length, sub } from '../physics/vector';
import { ORIGINAL_LENGTH_AU } from '../physics/originalInitializer';
import type { V04Settings } from './config';
export interface EnvironmentReading {
  celsius: number;
  kelvin: number;
  equilibriumKelvin: number;
  flux: number;
  albedo: number;
  distancesAU: number[];
  starDistancesAU: number[];
  model: 'radiative' | 'legacy';
}
export function radiationTemperature(
  distancesAU: readonly number[],
  luminosities: readonly number[],
  factor: number,
  phase: number,
): Pick<EnvironmentReading, 'celsius' | 'kelvin' | 'flux' | 'albedo' | 'equilibriumKelvin'> {
  // Original temperature AU = 1.496e11 m, independently of IAU physics conversion.
  const flux = distancesAU.reduce((sum, d, i) => {
    const r = (Math.max(d, 0.01 * ORIGINAL_LENGTH_AU) * AU_METERS) / 1.496e11 / factor;
    return sum + (1361 * (luminosities[i] ?? 0)) / (r * r);
  }, 0);
  const baseC = ((flux * 0.7) / (4 * 5.67e-8)) ** 0.25 - 273.15;
  const albedo = flux > 0 && baseC < 0 ? 0.3 + 0.3 * Math.min(1, -baseC / 20) : 0.3;
  const equilibriumKelvin = ((flux * (1 - albedo)) / (4 * 5.67e-8)) ** 0.25;
  const celsius = Number(
    Math.max(-270, Math.min(1500, equilibriumKelvin - 273.15 + 10 * Math.sin(phase))).toFixed(2),
  );
  return { celsius, kelvin: celsius + 273.15, equilibriumKelvin, flux, albedo };
}
export function readEnvironment(
  bodies: readonly Body[],
  physicalTime: number,
  settings: V04Settings,
): EnvironmentReading {
  const planet = bodies.find((b) => b.kind === 'planet'),
    stars = bodies.filter((b) => b.kind === 'star');
  const distancesAU = stars.map((s) =>
    planet ? length(sub(s.position, planet.position)) : Infinity,
  );
  const starDistancesAU: number[] = [];
  for (let i = 0; i < stars.length; i++)
    for (let j = i + 1; j < stars.length; j++)
      starDistancesAU.push(length(sub(stars[i]!.position, stars[j]!.position)));
  const reading = radiationTemperature(
    distancesAU,
    [settings.luminosityA, settings.luminosityB, settings.luminosityC],
    settings.temperatureDistanceFactor,
    physicalTime / 0.6,
  );
  if (settings.legacyTemperature) {
    const q = Math.max(
      0.1,
      Math.min(
        2,
        distancesAU.reduce(
          (sum, d, i) =>
            sum + ([0.4, 0.3, 0.3][i] ?? 0) / Math.sqrt(Math.max(d / ORIGINAL_LENGTH_AU, 1e-12)),
          0,
        ),
      ),
    );
    reading.celsius = 1190 * (q / 1.9) ** 2 - 220;
    reading.kelvin = reading.celsius + 273.15;
  }
  return {
    ...reading,
    model: settings.legacyTemperature ? 'legacy' : 'radiative',
    distancesAU,
    starDistancesAU,
  };
}
