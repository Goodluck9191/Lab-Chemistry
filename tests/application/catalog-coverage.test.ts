import { describe, expect, it } from "vitest";
import { catalogNotices } from "@/application/attempts/catalog-coverage";
import { exp02Standardisation } from "@/domain/experiments/catalog/exp-02-standardisation";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import { publicTitrationConfigView } from "@/domain/simulation/titration/public-view";

/**
 * The two descriptors of Experiment 2 must agree, or the student is shown a
 * "Configuration coverage" warning. This suite asserts that agreement against the
 * real catalog definition — the typed twin of `supabase/seed.sql`, whose keys the
 * live database carries — and that a GENUINE gap is still reported.
 */

const config = publicTitrationConfigView(exp02TitrationConfig);

/** The catalog half of the comparison, as the briefing publishes it. */
const catalog = {
  chemicals: exp02Standardisation.chemicals.map((chemical) => ({ key: chemical.key })),
  apparatus: exp02Standardisation.apparatus.map((item) => ({ key: item.key })),
};

describe("catalog coverage notices", () => {
  it("reports nothing when the catalog and the simulation describe the same experiment", () => {
    expect(catalogNotices(catalog, config)).toEqual([]);
  });

  it("does not read the catalog's inventory key as a vocabulary mismatch", () => {
    // The chemistry works with `hcl`; the inventory row is `hcl_unknown` with no
    // concentration. The stage states the binding, so the row's presence is
    // enough — an `hcl` row is neither present nor needed.
    expect(catalog.chemicals.map((chemical) => chemical.key)).toContain("hcl_unknown");
    expect(catalog.chemicals.map((chemical) => chemical.key)).not.toContain("hcl");
    expect(catalogNotices(catalog, config).join(" ")).not.toMatch(/hcl/i);
  });

  it("reports a reagent the catalog is genuinely missing, under its catalog key", () => {
    const withoutUnknownHCl = {
      ...catalog,
      chemicals: catalog.chemicals.filter((chemical) => chemical.key !== "hcl_unknown"),
    };

    const notices = catalogNotices(withoutUnknownHCl, config);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("hcl_unknown");
    expect(notices[0]).toMatch(/does not list these reagents/i);
  });

  it("reports the Part I stock solution when the catalog omits it", () => {
    const withoutStock = {
      ...catalog,
      chemicals: catalog.chemicals.filter((chemical) => chemical.key !== "naoh_stock_2m"),
    };

    expect(catalogNotices(withoutStock, config).join(" ")).toContain("naoh_stock_2m");
  });

  it("names the ware the stage actually uses, never the portion's kind name", () => {
    // Stage B portions its analyte by volume, which the protocol calls
    // `pipetted_volume` for compatibility. The manual uses a measuring cylinder,
    // so the notice must name the cylinder and never claim a pipette.
    const withoutCylinder = {
      ...catalog,
      apparatus: catalog.apparatus.filter((item) => item.key !== "graduated_cylinder"),
    };

    const notices = catalogNotices(withoutCylinder, config);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("graduated_cylinder");
    expect(notices[0]).not.toMatch(/pipette/i);
  });

  it("keeps every stage's catalog binding pointing at a real catalog row", () => {
    const chemicalKeys = new Set(catalog.chemicals.map((chemical) => chemical.key));
    const apparatusKeys = new Set(catalog.apparatus.map((item) => item.key));

    for (const stage of config.stages) {
      expect(chemicalKeys.has(stage.catalog.titrantKey)).toBe(true);
      expect(chemicalKeys.has(stage.catalog.analyteKey)).toBe(true);
      if (stage.analytePortion.kind === "pipetted_volume") {
        expect(apparatusKeys.has(stage.analytePortion.vessel)).toBe(true);
      }
    }
  });
});
