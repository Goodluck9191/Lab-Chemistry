/**
 * Molar masses used by the titration engine.
 *
 * SOURCE STATUS — read carefully:
 * - The manual gives the FORMULA of KHP (HKC8H4O4 / KHC8H4O4, Expt 2 p.16-17)
 *   but does NOT state its molar mass. The value below is computed from
 *   standard IUPAC atomic weights (K 39.0983, H 1.008, C 12.011, O 15.999),
 *   i.e. standard chemistry data, NOT a manual quotation.
 * - It is kept in one place so every calculation (engine, grading, tests)
 *   uses the identical constant. Displayed to students only through their own
 *   calculation results, never as a hidden answer.
 */
export const KHP_FORMULA = "KHC8H4O4" as const;

/** 39.0983 + 5*1.008 + 8*12.011 + 4*15.999 = 204.2223 g/mol. */
export const KHP_MOLAR_MASS_G_PER_MOL = 204.2223;

export const NAOH_MOLAR_MASS_G_PER_MOL = 39.997;
export const HCL_MOLAR_MASS_G_PER_MOL = 36.458;
export const NACL_MOLAR_MASS_G_PER_MOL = 58.44;

/**
 * Molar masses indexed by the chemical keys used in experiment configuration,
 * so a screen can show the reference constant that belongs to the analyte the
 * configuration names instead of hardcoding one in a component. Keys that are
 * not listed return null and the caller must omit the constant.
 */
export const CHEMICAL_MOLAR_MASSES_G_PER_MOL: Record<string, number> = {
  khp: KHP_MOLAR_MASS_G_PER_MOL,
  naoh: NAOH_MOLAR_MASS_G_PER_MOL,
  hcl: HCL_MOLAR_MASS_G_PER_MOL,
};

export function molarMassForChemical(chemicalKey: string): number | null {
  return CHEMICAL_MOLAR_MASSES_G_PER_MOL[chemicalKey] ?? null;
}
