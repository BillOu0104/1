/** AU, solar mass, G=1. SI conversions use IAU nominal solar radius and astronomical unit. */
export const AU_METERS = 149_597_870_700;
export const SOLAR_MASS_KG = 1.98847e30;
export const SOLAR_RADIUS_AU = 695_700_000 / AU_METERS;
export const EARTH_MASS = 5.9722e24 / SOLAR_MASS_KG;
export const EARTH_RADIUS = 6_371_000 / AU_METERS;
export const TIME_UNIT_SECONDS = Math.sqrt(AU_METERS ** 3 / (6.6743e-11 * SOLAR_MASS_KG));
export const VELOCITY_UNIT_KMS = AU_METERS / TIME_UNIT_SECONDS / 1000;
export const DEFAULT_MASSES: readonly number[] = [1, 0.95, 0.9];
/** Rounded observational references, not novel canon and not a real-orbit initializer. */
export const ALPHA_CENTAURI_REFERENCE = [
  { mass: 1.1, radiusSolar: 1.227, luminositySolar: 1.52, temperatureK: 5790 },
  { mass: 0.94, radiusSolar: 0.865, luminositySolar: 0.5, temperatureK: 5260 },
  { mass: 0.12, radiusSolar: 0.145, luminositySolar: 0.0015, temperatureK: 3050 },
] as const;
export function stellarProperties(mass: number): {
  radius: number;
  luminosity: number;
  temperatureK: number;
  color: string;
} {
  // Main-sequence approximations, explicitly simulation assumptions. Bolometric luminosity.
  const luminosity = mass < 0.43 ? 0.23 * mass ** 2.3 : mass ** 3.5;
  const temperatureK = 5772 * (luminosity / mass ** 1.6) ** 0.25;
  const t = Math.max(0, Math.min(1, (temperatureK - 3000) / 5000));
  const color =
    '#' +
    [255 - 35 * t, 165 + 75 * t, 110 + 145 * t]
      .map((v) => Math.round(v).toString(16).padStart(2, '0'))
      .join('');
  return { radius: SOLAR_RADIUS_AU * mass ** 0.8, luminosity, temperatureK, color };
}

/** IAU astronomical unit and exact speed of light. */
export const AU_PER_LIGHT_DAY = (299792458 * 86400) / AU_METERS;
export const auToLightDays = (au: number): number => au / AU_PER_LIGHT_DAY;
export const lightDaysToAu = (days: number): number => days * AU_PER_LIGHT_DAY;
