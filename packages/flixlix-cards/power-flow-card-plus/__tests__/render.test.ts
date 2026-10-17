// test that the card renders correctly

import { render as renderTemplate } from "lit";
import { describe, expect, test } from "vitest";

import { type PowerFlowCardPlusConfig } from "@flixlix-cards/shared/types";
import { PowerFlowCardPlus } from "../src/power-flow-card-plus";

// jsdom does not provide ResizeObserver; stub it so the card's `updated` hook doesn't throw
(globalThis as any).ResizeObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
};

type HassState = { state: string; attributes: Record<string, unknown> };

function makeHass(states: Record<string, string> = {}) {
  const hassStates: Record<string, HassState> = {};
  for (const [entityId, state] of Object.entries(states)) {
    hassStates[entityId] = {
      state,
      attributes: { friendly_name: entityId, unit_of_measurement: "W" },
    };
  }
  return {
    localize: (key: string) => key,
    locale: { language: "en", number_format: "comma_decimal" },
    states: hassStates,
    config: {},
    user: { name: "test" },
    connection: {},
  } as any;
}

function makeCard(config: PowerFlowCardPlusConfig, hass: ReturnType<typeof makeHass>) {
  const card = new PowerFlowCardPlus();
  card.setConfig(config);
  card.hass = hass;
  card.connectedCallback();
  return card as unknown as {
    render: () => unknown;
    _computeRenderData: () => ReturnType<typeof computeRenderDataShape>;
  };
}

// Used only as a type reference — actual return shape is inferred from _computeRenderData
declare function computeRenderDataShape(): {
  grid: {
    has: boolean;
    state: {
      fromGrid: number | null;
      toGrid: number | null;
      toBattery: number | null;
      toHome: number | null;
    };
  };
  solar: {
    has: boolean;
    state: {
      total: number | null;
      toHome: number | null;
      toGrid: number | null;
      toBattery: number | null;
    };
  };
  battery: {
    has: boolean | string;
    state: {
      fromBattery: number | null;
      toBattery: number | null;
      toGrid: number | null;
      toHome: number | null;
    };
  };
  individualObjs: Array<{ has: boolean; state: number | null }>;
};

describe("render", () => {
  test("renders correctly", () => {
    const config = {
      type: "custom:power-flow-card-plus",
      entities: {
        grid: { entity: "sensor.grid" },
        solar: { entity: "sensor.solar" },
        battery: { entity: "sensor.battery" },
      },
    } as PowerFlowCardPlusConfig;
    const card = new PowerFlowCardPlus();
    card.setConfig(config);
    card.connectedCallback();
    const rendered = (card as unknown as { render: () => unknown }).render();
    expect(rendered).toBeTruthy();
  });
});

describe("_computeRenderData", () => {
  test("case 1: grid-only consumption — fromGrid is the entity value and toHome follows", () => {
    const config = {
      type: "custom:power-flow-card-plus",
      entities: {
        grid: { entity: "sensor.grid" },
      },
    } as PowerFlowCardPlusConfig;
    const hass = makeHass({ "sensor.grid": "500" });
    const card = makeCard(config, hass);
    const data = card._computeRenderData();

    expect(data.grid.state.fromGrid).toBe(500);
    // toHome = max(fromGrid - toBattery, 0) = max(500 - 0, 0) = 500
    expect(data.grid.state.toHome).toBe(500);
    // No solar entity configured
    expect(data.solar.has).toBe(false);
    // No battery entity configured → battery.has is falsy
    expect(data.battery.has).toBeFalsy();
  });

  test("case 2: solar covers home and grid is zero — dependency rule zeroes grid toHome", () => {
    const config = {
      type: "custom:power-flow-card-plus",
      entities: {
        grid: { entity: "sensor.grid" },
        solar: { entity: "sensor.solar" },
      },
    } as PowerFlowCardPlusConfig;
    // grid produces nothing (0W), solar produces 1000W
    const hass = makeHass({ "sensor.grid": "0", "sensor.solar": "1000" });
    const card = makeCard(config, hass);
    const data = card._computeRenderData();

    expect(data.solar.state.total).toBe(1000);
    // fromGrid === 0 → the dependency rule at lines 791-794 forces toHome and toBattery to 0
    expect(data.grid.state.fromGrid).toBe(0);
    expect(data.grid.state.toHome).toBe(0);
    expect(data.grid.state.toBattery).toBe(0);
    // Solar covers all home consumption
    expect(data.solar.state.toHome).toBe(1000);
  });

  test("case 3: tolerance zeroing — grid below tolerance is treated as 0", () => {
    const config = {
      type: "custom:power-flow-card-plus",
      entities: {
        grid: { entity: "sensor.grid", display_zero_tolerance: 5 } as any,
      },
    } as PowerFlowCardPlusConfig;
    // 3W is below the 5W tolerance
    const hass = makeHass({ "sensor.grid": "3" });
    const card = makeCard(config, hass);
    const data = card._computeRenderData();

    expect(data.grid.state.fromGrid).toBe(0);
    // Dependency rule: fromGrid === 0 → toHome and toBattery also zeroed
    expect(data.grid.state.toHome).toBe(0);
    expect(data.grid.state.toBattery).toBe(0);
  });

  test("case 4: negative individual entity stays visible (Plan 001 regression guard)", () => {
    const config = {
      type: "custom:power-flow-card-plus",
      entities: {
        grid: { entity: "sensor.grid" },
        individual: [{ entity: "sensor.device" }],
      },
    } as PowerFlowCardPlusConfig;
    // Individual state is negative; getIndividualState applies Math.abs so state === 50
    const hass = makeHass({ "sensor.grid": "100", "sensor.device": "-50" });
    const card = makeCard(config, hass);
    const data = card._computeRenderData();

    expect(data.individualObjs).toHaveLength(1);
    const individual = data.individualObjs[0];
    // has === true: the device is visible even with a negative raw state
    expect(individual.has).toBe(true);
    // getIndividualState returns Math.abs of the raw value
    expect(individual.state).toBe(50);
  });

  test("case 5: unavailable entity — no NaN in grid state fields", () => {
    const config = {
      type: "custom:power-flow-card-plus",
      entities: {
        grid: { entity: "sensor.grid" },
        solar: { entity: "sensor.solar" },
      },
    } as PowerFlowCardPlusConfig;
    // "unavailable" is not a number; getEntityState returns null → getEntityStateWatts returns 0
    const hass = makeHass({ "sensor.grid": "unavailable", "sensor.solar": "unavailable" });
    const card = makeCard(config, hass);
    const data = card._computeRenderData();

    expect(Number.isNaN(data.grid.state.fromGrid)).toBe(false);
    expect(Number.isNaN(data.grid.state.toGrid)).toBe(false);
    expect(Number.isNaN(data.grid.state.toBattery)).toBe(false);
    expect(Number.isNaN(data.grid.state.toHome)).toBe(false);
    expect(Number.isNaN(data.solar.state.total)).toBe(false);
  });
});

describe("individual device overflow", () => {
  function setup(count: number, wide = true) {
    const individual = Array.from({ length: count }, (_, index) => ({
      entity: `sensor.consumer_${index}`,
      name: `Consumer ${index}`,
      color: "#38bdf8",
    }));
    const card = makeCard(
      {
        type: "custom:power-flow-card-plus",
        allow_layout_break: wide,
        kilo_threshold: 100000,
        w_decimals: 0,
        entities: {
          grid: { entity: "sensor.grid" },
          home: { subtract_individual: true },
          individual,
        },
      } as PowerFlowCardPlusConfig,
      makeHass({
        "sensor.grid": "10000",
        ...Object.fromEntries(individual.map((item) => [item.entity, "10"])),
      })
    ) as any;
    return card;
  }

  test.each([0, 2, 4, 6, 50])("renders every visible consumer with %i configured", (count) => {
    const card = setup(count);
    const data = card._computeRenderData();
    expect(data.individualObjs.length).toBe(Math.min(4, count));
    expect(data.overflowIndividualObjects.length).toBe(Math.max(0, count - 4));
    const all = [...data.individualObjs, ...data.overflowIndividualObjects];
    expect(new Set(all.map((item: any) => item.entity)).size).toBe(count);
    const container = document.createElement("div");
    renderTemplate(card.render(), container);
    expect(container.querySelectorAll(".individual-overflow-device").length).toBe(
      Math.max(0, count - 4)
    );
    card.disconnectedCallback();
  });

  test("narrow cards keep two diagram positions and render the remainder", () => {
    const card = setup(6, false);
    const data = card._computeRenderData();
    expect(data.individualObjs.length).toBe(2);
    expect(data.overflowIndividualObjects.length).toBe(4);
    card.disconnectedCallback();
  });

  test("hidden zero-value consumers do not create holes", () => {
    const card = setup(6);
    card.hass.states["sensor.consumer_0"].state = "0";
    const data = card._computeRenderData();
    const all = [...data.individualObjs, ...data.overflowIndividualObjects];
    expect(all.length).toBe(5);
    expect(all.some((item: any) => item.entity === "sensor.consumer_0")).toBe(false);
    card.disconnectedCallback();
  });

  test("rest-of-home accounting includes overflow consumers exactly once", () => {
    const card = setup(6);
    const data = card._computeRenderData();
    expect(data.homeUsageToDisplay.replace(/[^0-9]/g, "")).toBe("9940");
    card.disconnectedCallback();
  });

  test("overflow buttons retain entity actions", () => {
    const card = setup(6);
    let clicked = "";
    card.onEntityClick = (_event: MouseEvent, _field: unknown, entity: string) => {
      clicked = entity;
    };
    const container = document.createElement("div");
    renderTemplate(card.render(), container);
    const button = container.querySelector(".individual-overflow-device") as HTMLButtonElement;
    button.click();
    expect(clicked).toBe("sensor.consumer_4");
    card.disconnectedCallback();
  });
  test("additional consumers have animated source-to-device lines", () => {
    const card = setup(6);
    const container = document.createElement("div");
    renderTemplate(card.render(), container);
    expect(container.querySelectorAll(".individual-overflow-flow").length).toBe(2);
    const motion = container.querySelector(".individual-overflow-flow animateMotion");
    expect(motion?.getAttribute("keyPoints")).toBe("0;1");
    expect(Number.parseFloat(motion?.getAttribute("dur") ?? "0")).toBeGreaterThan(0);
    card.disconnectedCallback();
  });

  test("zero and unknown overflow values do not animate", () => {
    const card = setup(6);
    card._config.entities.individual[4].display_zero = true;
    card._config.entities.individual[5].display_zero = true;
    card.hass.states["sensor.consumer_4"].state = "0";
    card.hass.states["sensor.consumer_5"].state = "unknown";
    const container = document.createElement("div");
    renderTemplate(card.render(), container);
    expect(container.querySelectorAll(".individual-overflow-device").length).toBe(2);
    expect(container.querySelectorAll(".individual-overflow-flow animateMotion").length).toBe(0);
    expect(container.querySelectorAll(".individual-overflow-value")[1].textContent?.trim()).toBe(
      "—"
    );
    card.disconnectedCallback();
  });

  test("disable_dots disables extra flow animation", () => {
    const card = setup(6);
    card._config.disable_dots = true;
    const container = document.createElement("div");
    renderTemplate(card.render(), container);
    expect(container.querySelectorAll(".individual-overflow-flow").length).toBe(2);
    expect(container.querySelectorAll(".individual-overflow-flow animateMotion").length).toBe(0);
    card.disconnectedCallback();
  });

  test("inverted animation reverses only the configured consumer", () => {
    const card = setup(6);
    card._config.entities.individual[4].inverted_animation = true;
    const container = document.createElement("div");
    renderTemplate(card.render(), container);
    const motions = container.querySelectorAll(".individual-overflow-flow animateMotion");
    expect(motions[0].getAttribute("keyPoints")).toBe("1;0");
    expect(motions[1].getAttribute("keyPoints")).toBe("0;1");
    card.disconnectedCallback();
  });

  test("hidden home also hides extra source connections", () => {
    const card = setup(6);
    card._config.entities.home.hide = true;
    const container = document.createElement("div");
    renderTemplate(card.render(), container);
    expect(container.querySelectorAll(".individual-overflow-flow").length).toBe(0);
    card.disconnectedCallback();
  });
  test("explicit main placement takes priority, additional never fills a diagram slot", () => {
    const card = setup(6);
    card._config.entities.individual[0].placement = "additional";
    card._config.entities.individual[5].placement = "main";
    const data = card._computeRenderData();
    expect(data.individualObjs.map((item: any) => item.entity)).toEqual([
      "sensor.consumer_5",
      "sensor.consumer_1",
      "sensor.consumer_2",
      "sensor.consumer_3",
    ]);
    expect(data.overflowIndividualObjects.map((item: any) => item.entity)).toEqual([
      "sensor.consumer_0",
      "sensor.consumer_4",
    ]);
    expect(data.homeUsageToDisplay.replace(/[^0-9]/g, "")).toBe("9940");
    card.disconnectedCallback();
  });

  test("main preferences exceeding narrow capacity still render every consumer", () => {
    const card = setup(6, false);
    card._config.entities.individual.forEach((device: any) => (device.placement = "main"));
    const data = card._computeRenderData();
    expect(data.individualObjs).toHaveLength(2);
    expect(data.overflowIndividualObjects).toHaveLength(4);
    card.disconnectedCallback();
  });

  test("all consumers may use the additional area without disappearing", () => {
    const card = setup(6);
    card._config.entities.individual.forEach((device: any) => (device.placement = "additional"));
    const data = card._computeRenderData();
    expect(data.individualObjs).toHaveLength(0);
    expect(data.overflowIndividualObjects).toHaveLength(6);
    card.disconnectedCallback();
  });
});
