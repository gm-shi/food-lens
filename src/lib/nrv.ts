/**
 * Australian reference values used for pregnancy targets.
 * Source: NHMRC Nutrient Reference Values (nrv.gov.au), Eat for Health, NSW Health, FSANZ,
 * Australian Pregnancy Care Guidelines (gestational weight gain, after IOM 2009).
 * Every number here is checked against the official page; see README "Reference values".
 */
import type { NutrientKey } from './nutrients';

/** Energy: Schofield BMR (MJ/day) for women, by age band, then × PAL, plus pregnancy additions. */
export const SCHOFIELD_WOMEN = {
  // 18-30 y: 0.062 × kg + 2.036 ; 30-60 y: 0.034 × kg + 3.538  (MJ/day)
  young: { a: 0.062, b: 2.036 },
  middle: { a: 0.034, b: 3.538 },
};
export const PAL: Record<'low' | 'moderate' | 'high', number> = { low: 1.4, moderate: 1.6, high: 1.8 };
/** Additional energy in trimester 2 and 3 (MJ/day). */
export const ENERGY_ADD_MJ = { t2: 1.4, t3: 1.9 };
export const KCAL_PER_MJ = 239;

export interface Nrv {
  /** daily target (RDI or AI) for pregnancy 19-50 y */
  value: number;
  /** trimester-1 value where the NRVs give the non-pregnant figure for the first trimester */
  t1?: number;
  /** upper level of intake where one is set and relevant to food tracking */
  upper?: number;
  /** 'limit' = stay under this value rather than reach it */
  kind: 'target' | 'limit';
}

/**
 * Pregnancy, women 19-50 y (NHMRC NRV, eatforhealth.gov.au/nutrient-reference-values/nutrients/...).
 * Energy and carbs/fat are handled separately. Verified against the official pages on 2026-10-14.
 */
export const NRV: Partial<Record<NutrientKey, Nrv>> = {
  // RDI 60 g/day in trimesters 2-3; the NRVs apply the non-pregnant 46 g/day in trimester 1
  protein: { value: 60, t1: 46, kind: 'target' },
  fiber: { value: 28, kind: 'target' },
  calcium: { value: 1000, upper: 2500, kind: 'target' },
  iron: { value: 27, upper: 45, kind: 'target' },
  folate: { value: 600, kind: 'target' },
  vitC: { value: 60, kind: 'target' },
  // The 3000 µg UL applies to preformed retinol only; our photo estimate is total RE including carotenoids, so no upper limit is shown.
  vitA: { value: 800, kind: 'target' },
  // AI for total long-chain omega-3 (DHA + EPA + DPA); the NRVs set no DHA-only figure
  dha: { value: 115, kind: 'target' },
  iodine: { value: 220, upper: 1100, kind: 'target' },
  vitD: { value: 5, kind: 'target' },
  // NSW Health / Eat for Health: keep caffeine to 200 mg/day or less in pregnancy
  caffeine: { value: 200, kind: 'limit' },
};

/** Gestational weight gain by pre-pregnancy BMI (kg total; kg/week in trimesters 2-3). */
export interface GainBand {
  totalMin: number;
  totalMax: number;
  rateMin: number;
  rateMax: number;
}
export const WEIGHT_GAIN: { underweight: GainBand; healthy: GainBand; overweight: GainBand; obese: GainBand } = {
  underweight: { totalMin: 12.5, totalMax: 18, rateMin: 0.44, rateMax: 0.58 },
  healthy: { totalMin: 11.5, totalMax: 16, rateMin: 0.35, rateMax: 0.5 },
  overweight: { totalMin: 7, totalMax: 11.5, rateMin: 0.23, rateMax: 0.33 },
  obese: { totalMin: 5, totalMax: 9, rateMin: 0.17, rateMax: 0.27 },
};
/** First-trimester gain commonly cited as 0.5-2 kg in total. */
export const T1_GAIN = { min: 0.5, max: 2 };
