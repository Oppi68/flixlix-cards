import localize from "@flixlix-cards/shared/i18n";
import {
  type IndividualDeviceType,
  type PowerFlowCardPlusConfig,
} from "@flixlix-cards/shared/types";
import { individualSchema } from "@flixlix-cards/shared/ui-editor/schema/individual";
import { fireEvent, type HomeAssistant } from "custom-card-helpers";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

/** Power-specific placement controls; other cards keep their existing editor. */
@customElement("power-individual-editor")
export class PowerIndividualEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config!: PowerFlowCardPlusConfig;
  @state() private _editing = -1;
  @state() private _error = "";

  private _label(key: string) {
    return localize(`editor.individual_layout.${key}`);
  }

  private _publish(individual: IndividualDeviceType[]) {
    const config = { ...this.config, entities: { ...this.config.entities, individual } };
    this.config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _addEntity(ev: CustomEvent) {
    ev.stopPropagation();
    const entity = ev.detail.value as string;
    if (!entity) return;
    const devices = this.config.entities.individual ?? [];
    const unit = this.hass.states[entity]?.attributes.unit_of_measurement;
    if (unit && !["W", "kW"].includes(unit)) {
      this._error = this._label("power_help");
      return;
    }
    if (devices.some((device) => device.entity === entity)) {
      this._error = this._label("duplicate");
      return;
    }
    this._error = "";
    this._publish([...devices, { entity, placement: "auto", display_zero: true }]);
    (ev.target as any).value = "";
  }

  private _update(index: number, patch: Partial<IndividualDeviceType>) {
    this._publish(
      (this.config.entities.individual ?? []).map((device, i) =>
        i === index ? { ...device, ...patch } : device
      )
    );
  }

  private _remove(index: number) {
    this._editing = -1;
    this._publish((this.config.entities.individual ?? []).filter((_, i) => i !== index));
  }

  private _move(index: number, offset: number) {
    const devices = [...(this.config.entities.individual ?? [])];
    const next = index + offset;
    if (next < 0 || next >= devices.length) return;
    [devices[index], devices[next]] = [devices[next]!, devices[index]!];
    this._publish(devices);
  }

  private _detailsChanged(ev: CustomEvent) {
    ev.stopPropagation();
    const value = ev.detail.value as IndividualDeviceType;
    if (!value?.entity) return;
    const devices = this.config.entities.individual ?? [];
    if (
      devices.some((device, index) => index !== this._editing && device.entity === value.entity)
    ) {
      this._error = this._label("duplicate");
      return;
    }
    this._error = "";
    this._update(this._editing, value);
  }

  protected render() {
    if (!this.config || !this.hass) return nothing;
    const devices = this.config.entities.individual ?? [];
    const capacity = this.config.allow_layout_break ? "4" : "2–4";
    const mainCount = devices.filter((device) => device.placement === "main").length;
    return html`
      <p class="help">${this._label("help")} (${capacity})</p>
      ${mainCount > 4
        ? html`<ha-alert alert-type="warning">${this._label("full")}</ha-alert>`
        : nothing}
      ${this.config.sort_individual_devices
        ? html`<ha-alert alert-type="info">${this._label("sorted")}</ha-alert>`
        : nothing}
      ${this._error ? html`<ha-alert alert-type="error">${this._error}</ha-alert>` : nothing}
      <div class="devices">
        ${devices.map((device, index) => {
          const name =
            device.name ||
            this.hass.states[device.entity]?.attributes.friendly_name ||
            device.entity;
          return html`
            <section class="device">
              <div class="row">
                <strong>${name}</strong>
                <button
                  type="button"
                  aria-label=${`${this._label("up")}: ${name}`}
                  ?disabled=${index === 0}
                  @click=${() => this._move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label=${`${this._label("down")}: ${name}`}
                  ?disabled=${index === devices.length - 1}
                  @click=${() => this._move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  @click=${() => {
                    this._editing = this._editing === index ? -1 : index;
                  }}
                >
                  ${this._label("edit")}
                </button>
                <button
                  type="button"
                  aria-label=${`${this._label("remove")}: ${name}`}
                  @click=${() => this._remove(index)}
                >
                  ×
                </button>
              </div>
              <label class="placement"
                >${this._label("placement")}
                <select
                  .value=${device.placement ?? "auto"}
                  @change=${(ev: Event) =>
                    this._update(index, {
                      placement: (ev.target as HTMLSelectElement)
                        .value as IndividualDeviceType["placement"],
                    })}
                >
                  <option value="auto">${this._label("auto")}</option>
                  <option value="main">${this._label("main")}</option>
                  <option value="additional">${this._label("additional")}</option>
                </select>
              </label>
              ${this._editing === index
                ? html`
                    <ha-form
                      .hass=${this.hass}
                      .data=${device}
                      .schema=${individualSchema}
                      .computeLabel=${(schema: any) =>
                        this.hass.localize(
                          `ui.panel.lovelace.editor.card.generic.${schema.name}`
                        ) ||
                        schema.label ||
                        localize(`editor.${schema.name}`)}
                      @value-changed=${this._detailsChanged}
                    ></ha-form>
                  `
                : nothing}
            </section>
          `;
        })}
      </div>
      <h4>${this._label("add")}</h4>
      <ha-entity-picker
        class="add-entity"
        .hass=${this.hass}
        .label=${this._label("power_entity")}
        .includeDomains=${["sensor"]}
        @value-changed=${this._addEntity}
      ></ha-entity-picker>
      <p class="help">${this._label("power_help")}</p>
    `;
  }

  static styles = css`
    :host {
      display: block;
    }
    .help {
      color: var(--secondary-text-color);
      line-height: 1.5;
    }
    .devices {
      display: grid;
      gap: 12px;
      margin-top: 12px;
    }
    .device {
      padding: 12px;
      border: 1px solid var(--divider-color);
      border-radius: 12px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    strong {
      flex: 1 1 140px;
      overflow-wrap: anywhere;
    }
    button,
    select {
      font: inherit;
      color: var(--primary-text-color);
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      padding: 8px;
    }
    button {
      cursor: pointer;
      min-height: 40px;
    }
    button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    button:focus-visible,
    select:focus-visible {
      outline: 2px solid var(--primary-color);
    }
    .placement {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    select {
      flex: 1;
      min-width: 150px;
    }
    ha-entity-picker {
      display: block;
      width: 100%;
    }
  `;
}
