import { describe, expect, test } from "vitest";
import { PowerIndividualEditor } from "../src/ui-editor/power-individual-editor";
import { PowerFlowCardPlusEditor } from "../src/ui-editor/ui-editor";

async function setup() {
  const editor = new PowerIndividualEditor();
  editor.hass = {
    states: {
      "sensor.lamp": {
        state: "5",
        attributes: { unit_of_measurement: "W", friendly_name: "Lamp" },
      },
      "sensor.energy": { state: "2", attributes: { unit_of_measurement: "kWh" } },
    },
    localize: () => "",
  } as any;
  editor.config = {
    type: "custom:power-flow-card-plus",
    entities: {
      individual: [{ entity: "sensor.tv", color: "#abcdef", tap_action: { action: "more-info" } }],
    },
  } as any;
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

describe("visual individual configuration", () => {
  test("picker adds an unlimited consumer and prevents duplicate and energy entries", async () => {
    const editor = await setup();
    const events: any[] = [];
    editor.addEventListener("config-changed", (ev: any) => events.push(ev.detail.config));
    const picker = editor.shadowRoot!.querySelector(".add-entity")!;
    const add = (value: string) =>
      picker.dispatchEvent(new CustomEvent("value-changed", { detail: { value } }));
    add("sensor.lamp");
    expect(events[0].entities.individual).toHaveLength(2);
    expect(events[0].entities.individual[1]).toMatchObject({
      entity: "sensor.lamp",
      placement: "auto",
    });
    add("sensor.lamp");
    add("sensor.energy");
    expect(events).toHaveLength(1);
    for (let i = 0; i < 12; i++) add(`sensor.extra_${i}`);
    expect(editor.config.entities.individual).toHaveLength(14);
    editor.remove();
  });

  test("placement, reorder, details and removal retain existing device options", async () => {
    const editor = await setup();
    const picker = editor.shadowRoot!.querySelector(".add-entity")!;
    picker.dispatchEvent(new CustomEvent("value-changed", { detail: { value: "sensor.lamp" } }));
    await editor.updateComplete;
    const select = editor.shadowRoot!.querySelector("select")!;
    select.value = "additional";
    select.dispatchEvent(new Event("change"));
    expect(editor.config.entities.individual![0]).toMatchObject({
      placement: "additional",
      color: "#abcdef",
      tap_action: { action: "more-info" },
    });
    await editor.updateComplete;
    const rows = editor.shadowRoot!.querySelectorAll(".device");
    (rows[1].querySelector("button") as HTMLButtonElement).click();
    expect(editor.config.entities.individual![0].entity).toBe("sensor.lamp");
    await editor.updateComplete;
    const buttons = editor.shadowRoot!.querySelectorAll(".device")[0].querySelectorAll("button");
    (buttons[2] as HTMLButtonElement).click();
    await editor.updateComplete;
    editor
      .shadowRoot!.querySelector("ha-form")!
      .dispatchEvent(
        new CustomEvent("value-changed", {
          detail: { value: { entity: "sensor.lamp", name: "Desk", placement: "main" } },
        })
      );
    expect(editor.config.entities.individual![0]).toMatchObject({
      name: "Desk",
      placement: "main",
    });
    await editor.updateComplete;
    const remove = editor
      .shadowRoot!.querySelectorAll(".device")[0]
      .querySelectorAll("button")[3] as HTMLButtonElement;
    remove.click();
    expect(editor.config.entities.individual).toHaveLength(1);
    expect(editor.config.entities.individual![0].color).toBe("#abcdef");
    editor.remove();
  });

  test("original configuration menu retains all pages and handles nested config events", async () => {
    const editor = new PowerFlowCardPlusEditor();
    editor.hass = { states: {}, localize: () => "" } as any;
    await editor.setConfig({
      type: "custom:power-flow-card-plus",
      entities: { individual: [] },
    } as any);
    document.body.append(editor);
    await editor.updateComplete;
    const links = editor.shadowRoot!.querySelectorAll("link-subpage");
    expect([...links].map((link) => link.getAttribute("path"))).toEqual([
      "grid",
      "solar",
      "battery",
      "fossil_fuel_percentage",
      "home",
      "individual",
      "advanced",
    ]);
    links[5].dispatchEvent(new CustomEvent("open-sub-element-editor"));
    await editor.updateComplete;
    const child = editor.shadowRoot!.querySelector(
      "power-individual-editor"
    ) as PowerIndividualEditor;
    expect(child).toBeTruthy();
    let received: any;
    editor.addEventListener("config-changed", (ev: any) => (received = ev.detail.config));
    const config = {
      ...child.config,
      entities: {
        ...child.config.entities,
        individual: [{ entity: "sensor.new", placement: "main" }],
      },
    };
    child.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })
    );
    expect(received).toEqual(config);
    editor.remove();
  });
});
