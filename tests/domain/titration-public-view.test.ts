import { describe, expect, it } from "vitest";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import { publicTitrationConfigView } from "@/domain/simulation/titration/public-view";
import { parseTitrationConfig } from "@/domain/simulation/titration/config";

describe("public titration configuration view", () => {
  it("exposes the apparatus, indicator and trial rules a student must know", () => {
    const view = publicTitrationConfigView(exp02TitrationConfig);

    expect(view.experimentNumber).toBe(2);
    expect(view.stages.map((stage) => stage.key)).toEqual([
      "stage-a-khp-naoh",
      "stage-b-hcl-naoh",
    ]);

    const [stageA, stageB] = view.stages;
    expect(stageA.titrantKey).toBe("naoh");
    expect(stageA.analyteKey).toBe("khp");
    expect(stageA.burette.capacityMl).toBe(50);
    expect(stageA.burette.graduationMl).toBe(0.1);
    expect(stageA.burette.readingPrecisionMl).toBe(0.02);
    expect(stageA.indicator.name).toBe("Phenolphthalein");
    expect(stageA.indicator.acidColour).toBe("colourless");
    expect(stageA.indicator.baseColour).toBe("pink");
    expect(stageA.indicator.drops).toEqual([3, 4]);
    expect(stageA.analytePortion).toMatchObject({ kind: "weighed_mass", nominalMassG: 0.6 });

    expect(stageB.analyteKey).toBe("hcl");
    expect(stageB.analytePortion).toMatchObject({ kind: "pipetted_volume", nominalVolumeMl: 25 });

    expect(view.trialRules).toMatchObject({
      minTrials: 3,
      maxTrials: 4,
      discardOnOvershoot: true,
      concordance: { mode: "molarity", maxSpreadM: 0.005 },
    });
  });

  it("withholds every parameter that would narrow the answer", () => {
    const serialised = JSON.stringify(publicTitrationConfigView(exp02TitrationConfig));

    expect(serialised).not.toContain("hiddenRanges");
    expect(serialised).not.toContain("endpointBiasMl");
    expect(serialised).not.toContain("readingNoiseMl");
    expect(serialised).not.toContain("assessmentWeights");
    expect(serialised).not.toContain("unknownAnalyteMolarityM");
    expect(serialised).not.toContain("rubricWeights");
    // The bracketing range for the true titrant strength must not appear.
    expect(serialised).not.toContain("0.18");
    expect(serialised).not.toContain("0.22");
    expect(serialised).not.toContain("0.25");
  });

  it("copies rather than references the configuration", () => {
    const view = publicTitrationConfigView(exp02TitrationConfig);
    view.stages[0].indicator.drops[0] = 99;
    view.stages[0].stoichiometry.titrantCoefficient = 7;
    expect(exp02TitrationConfig.stages[0].indicator.drops[0]).toBe(3);
    expect(exp02TitrationConfig.stages[0].stoichiometry.titrantCoefficient).toBe(1);
  });

  it("reports titre-volume concordance rules for a configuration that uses them", () => {
    const config = parseTitrationConfig({
      experimentNumber: 9,
      nominalTitrantMolarityM: 0.1,
      hiddenRanges: { titrantMolarityM: [0.09, 0.11], unknownAnalyteMolarityM: null },
      readingNoiseMl: 0.02,
      endpointBiasMl: 0.05,
      stages: [
        {
          key: "stage-x",
          title: "Precipitation example",
          family: "precipitation",
          endpointStyle: "indicator_colour",
          reactionEquation: "Ag+ + Cl- -> AgCl",
          stoichiometry: { analyteCoefficient: 1, titrantCoefficient: 1 },
          titrantKey: "agno3",
          analyteKey: "nacl",
          analytePortion: { kind: "pipetted_volume", nominalVolumeMl: 10, volumePrecisionMl: 0.02 },
          indicator: {
            key: "dichlorofluorescein",
            name: "Dichlorofluorescein",
            acidColour: "colourless",
            baseColour: "pink",
            drops: [3, 4],
            endpointPersistenceSeconds: [30, 60],
            transitionPhRange: null,
          },
          burette: {
            capacityMl: 50,
            graduationMl: 0.1,
            readingPrecisionMl: 0.02,
            maxDeliveredMl: 50,
          },
        },
      ],
      trialRules: {
        minTrials: 3,
        maxTrials: 4,
        discardOnOvershoot: true,
        concordance: { mode: "titre_volume", toleranceMl: 0.1, minConcordantCount: 3 },
      },
      assessmentWeights: { technique: 50, endpoint: 50 },
    });

    const view = publicTitrationConfigView(config);
    expect(view.trialRules.concordance).toEqual({
      mode: "titre_volume",
      toleranceMl: 0.1,
      minConcordantCount: 3,
    });
  });
});
