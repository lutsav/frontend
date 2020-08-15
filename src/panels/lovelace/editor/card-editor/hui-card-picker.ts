import "@material/mwc-tab-bar/mwc-tab-bar";
import "@material/mwc-tab/mwc-tab";
import Fuse from "fuse.js";
import memoizeOne from "memoize-one";
import {
  css,
  CSSResult,
  customElement,
  html,
  LitElement,
  property,
  internalProperty,
  PropertyValues,
  TemplateResult,
} from "lit-element";
import { classMap } from "lit-html/directives/class-map";
import { styleMap } from "lit-html/directives/style-map";
import { until } from "lit-html/directives/until";
import { fireEvent } from "../../../../common/dom/fire_event";
import "../../../../common/search/search-input";
import { UNAVAILABLE_STATES } from "../../../../data/entity";
import { LovelaceCardConfig, LovelaceConfig } from "../../../../data/lovelace";
import {
  CustomCardEntry,
  customCards,
  CUSTOM_TYPE_PREFIX,
  getCustomCardEntry,
} from "../../../../data/lovelace_custom_cards";
import type { HomeAssistant } from "../../../../types";
import {
  computeUsedEntities,
  computeUnusedEntities,
} from "../../common/compute-unused-entities";
import { tryCreateCardElement } from "../../create-element/create-card-element";
import { LovelaceCard } from "../../types";
import { getCardStubConfig } from "../get-card-stub-config";
import { CardPickTarget, Card } from "../types";
import { coreCards } from "../lovelace-cards";
import "../../../../components/ha-circular-progress";
import "../../../../components/data-table/ha-data-table";
import { computeStateName } from "../../../../common/entity/compute_state_name";
import { computeDomain } from "../../../../common/entity/compute_domain";
import { computeRTLDirection } from "../../../../common/util/compute_rtl";
import type { DataTableRowData } from "../../../../components/data-table/ha-data-table";
import "../../../../components/entity/state-badge";

interface CardElement {
  card: Card;
  element: TemplateResult;
}

@customElement("hui-card-picker")
export class HuiCardPicker extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @internalProperty() private _cards: CardElement[] = [];

  public lovelace?: LovelaceConfig;

  public cardPicked?: (cardConf: LovelaceCardConfig) => void;

  @internalProperty() private _filter = "";

  private _unusedEntities?: string[];

  private _usedEntities?: string[];

  @internalProperty() private _width?: number;

  @internalProperty() private _height?: number;

  @internalProperty() private _tabIndex = 0;

  private _filterCards = memoizeOne(
    (cardElements: CardElement[], filter?: string): CardElement[] => {
      if (!filter) {
        return cardElements;
      }
      let cards = cardElements.map(
        (cardElement: CardElement) => cardElement.card
      );
      const options: Fuse.IFuseOptions<Card> = {
        keys: ["type", "name", "description"],
        isCaseSensitive: false,
        minMatchCharLength: 2,
        threshold: 0.2,
      };
      const fuse = new Fuse(cards, options);
      cards = fuse.search(filter).map((result) => result.item);
      return cardElements.filter((cardElement: CardElement) =>
        cards.includes(cardElement.card)
      );
    }
  );

  private _columns = memoizeOne(() => {
    return {
      icon: {
        title: "",
        type: "icon",
        template: (_icon, entity: any) => html`
          <state-badge
            .hass=${this.hass!}
            .stateObj=${entity.stateObj}
          ></state-badge>
        `,
      },
      name: {
        title: this.hass!.localize("ui.panel.lovelace.unused_entities.entity"),
        sortable: true,
        filterable: true,
        grows: true,
        direction: "asc",
        template: (name, entity: any) => html`
          <div style="cursor: pointer;">
            ${name}
            <div class="secondary">
              ${entity.stateObj.entity_id}
            </div>
          </div>
        `,
      },
    };
  });

  protected render(): TemplateResult {
    if (
      !this.hass ||
      !this.lovelace ||
      !this._unusedEntities ||
      !this._usedEntities
    ) {
      return html``;
    }

    return html`
      <mwc-tab-bar
        .activeIndex=${this._tabIndex}
        @MDCTabBar:activated=${(tabIndex) => {
          this._tabIndex = tabIndex.detail.index;
        }}
      >
        <mwc-tab label="By Card"></mwc-tab>
        <mwc-tab label="By Entity"></mwc-tab>
      </mwc-tab-bar>
      ${this._tabIndex === 0
        ? html`
            <search-input
              .filter=${this._filter}
              no-label-float
              @value-changed=${this._handleSearchChange}
              .label=${this.hass.localize(
                "ui.panel.lovelace.editor.card.generic.search"
              )}
            ></search-input>
            <div
              id="content"
              style=${styleMap({
                width: this._width ? `${this._width}px` : "auto",
                height: this._height ? `${this._height}px` : "auto",
              })}
            >
              <div class="cards-container">
                ${this._filterCards(this._cards, this._filter).map(
                  (cardElement: CardElement) => cardElement.element
                )}
              </div>
              <div class="cards-container">
                <div
                  class="card manual"
                  @click=${this._cardPicked}
                  .config=${{ type: "" }}
                >
                  <div class="card-header">
                    ${this.hass!.localize(
                      `ui.panel.lovelace.editor.card.generic.manual`
                    )}
                  </div>
                  <div class="preview description">
                    ${this.hass!.localize(
                      `ui.panel.lovelace.editor.card.generic.manual_description`
                    )}
                  </div>
                </div>
              </div>
            </div>
          `
        : html`
            <div class="container">
              <ha-data-table
                .columns=${this._columns()}
                .data=${this._unusedEntities.map((entity) => {
                  const stateObj = this.hass!.states[entity];
                  return {
                    icon: "",
                    entity_id: entity,
                    stateObj,
                    name: computeStateName(stateObj),
                    domain: computeDomain(entity),
                    last_changed: stateObj!.last_changed,
                  };
                }) as DataTableRowData[]}
                .id=${"entity_id"}
                selectable
                .dir=${computeRTLDirection(this.hass)}
                .searchLabel=${this.hass.localize(
                  "ui.panel.lovelace.unused_entities.search"
                )}
              ></ha-data-table>
            </div>
          `}
    `;
  }

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    const oldHass = changedProps.get("hass") as HomeAssistant | undefined;
    if (!oldHass) {
      return true;
    }

    if (oldHass.language !== this.hass!.language) {
      return true;
    }

    return false;
  }

  protected firstUpdated(): void {
    if (!this.hass || !this.lovelace) {
      return;
    }

    const unusedEntities = computeUnusedEntities(this.hass, this.lovelace!);
    this._unusedEntities = [...unusedEntities].sort();

    const usedEntities = computeUsedEntities(this.lovelace);
    // const unusedEntities = calcUnusedEntities(this.hass, usedEntities);

    this._usedEntities = [...usedEntities].filter(
      (eid) =>
        this.hass!.states[eid] &&
        !UNAVAILABLE_STATES.includes(this.hass!.states[eid].state)
    );
    this._unusedEntities = [...unusedEntities].filter(
      (eid) =>
        this.hass!.states[eid] &&
        !UNAVAILABLE_STATES.includes(this.hass!.states[eid].state)
    );

    this._loadCards();
  }

  private _loadCards() {
    let cards: Card[] = coreCards.map((card: Card) => ({
      name: this.hass!.localize(
        `ui.panel.lovelace.editor.card.${card.type}.name`
      ),
      description: this.hass!.localize(
        `ui.panel.lovelace.editor.card.${card.type}.description`
      ),
      ...card,
    }));
    if (customCards.length > 0) {
      cards = cards.concat(
        customCards.map((ccard: CustomCardEntry) => ({
          type: ccard.type,
          name: ccard.name,
          description: ccard.description,
          showElement: ccard.preview,
          isCustom: true,
        }))
      );
    }
    this._cards = cards.map((card: Card) => ({
      card: card,
      element: html`${until(
        this._renderCardElement(card),
        html`
          <div class="card spinner">
            <ha-circular-progress active alt="Loading"></ha-circular-progress>
          </div>
        `
      )}`,
    }));
  }

  private _handleSearchChange(ev: CustomEvent) {
    const value = ev.detail.value;

    if (!value) {
      // Reset when we no longer filter
      this._width = undefined;
      this._height = undefined;
    } else if (!this._width || !this._height) {
      // Save height and width so the dialog doesn't jump while searching
      const div = this.shadowRoot!.getElementById("content");
      if (div && !this._width) {
        const width = div.clientWidth;
        if (width) {
          this._width = width;
        }
      }
      if (div && !this._height) {
        const height = div.clientHeight;
        if (height) {
          this._height = height;
        }
      }
    }

    this._filter = value;
  }

  static get styles(): CSSResult[] {
    return [
      css`
        .cards-container {
          display: grid;
          grid-gap: 8px 8px;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          margin-top: 20px;
        }

        .card {
          height: 100%;
          max-width: 500px;
          display: flex;
          flex-direction: column;
          border-radius: 4px;
          border: 1px solid var(--divider-color);
          background: var(--primary-background-color, #fafafa);
          cursor: pointer;
          box-sizing: border-box;
          position: relative;
        }

        .card-header {
          color: var(--ha-card-header-color, --primary-text-color);
          font-family: var(--ha-card-header-font-family, inherit);
          font-size: 16px;
          font-weight: bold;
          letter-spacing: -0.012em;
          line-height: 20px;
          padding: 12px 16px;
          display: block;
          text-align: center;
          background: var(
            --ha-card-background,
            var(--card-background-color, white)
          );
          border-radius: 0 0 4px 4px;
          border-bottom: 1px solid var(--divider-color);
        }

        .preview {
          pointer-events: none;
          margin: 20px;
          flex-grow: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .preview > :first-child {
          zoom: 0.6;
          display: block;
          width: 100%;
        }

        .description {
          text-align: center;
        }

        .spinner {
          align-items: center;
          justify-content: center;
        }

        .overlay {
          position: absolute;
          width: 100%;
          height: 100%;
          z-index: 1;
        }

        .manual {
          max-width: none;
        }

        ha-card {
          --ha-card-box-shadow: none;
          --ha-card-border-radius: 0;
        }
        ha-data-table {
          --data-table-border-width: 0;
          flex-grow: 1;
          margin-top: -20px;
        }

        .container {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: calc(100vh - 112px);
        }
      `,
    ];
  }

  private _cardPicked(ev: Event): void {
    const config: LovelaceCardConfig = (ev.currentTarget! as CardPickTarget)
      .config;

    fireEvent(this, "config-changed", { config });
  }

  private _tryCreateCardElement(cardConfig: LovelaceCardConfig) {
    const element = tryCreateCardElement(cardConfig) as LovelaceCard;
    element.hass = this.hass;
    element.addEventListener(
      "ll-rebuild",
      (ev) => {
        ev.stopPropagation();
        this._rebuildCard(element, cardConfig);
      },
      { once: true }
    );
    return element;
  }

  private _rebuildCard(
    cardElToReplace: LovelaceCard,
    config: LovelaceCardConfig
  ): void {
    let newCardEl: LovelaceCard;
    try {
      newCardEl = this._tryCreateCardElement(config);
    } catch (err) {
      return;
    }
    if (cardElToReplace.parentElement) {
      cardElToReplace.parentElement!.replaceChild(newCardEl, cardElToReplace);
    }
  }

  private async _renderCardElement(card: Card): Promise<TemplateResult> {
    let { type } = card;
    const { showElement, isCustom, name, description } = card;
    const customCard = isCustom ? getCustomCardEntry(type) : undefined;
    if (isCustom) {
      type = `${CUSTOM_TYPE_PREFIX}${type}`;
    }

    let element: LovelaceCard | undefined;
    let cardConfig: LovelaceCardConfig = { type };

    if (this.hass && this.lovelace) {
      cardConfig = await getCardStubConfig(
        this.hass,
        type,
        this._unusedEntities!,
        this._usedEntities!
      );

      if (showElement) {
        try {
          element = this._tryCreateCardElement(cardConfig);
        } catch (err) {
          element = undefined;
        }
      }
    }

    return html`
      <div class="card">
        <div
          class="overlay"
          @click=${this._cardPicked}
          .config=${cardConfig}
        ></div>
        <div class="card-header">
          ${customCard
            ? `${this.hass!.localize(
                "ui.panel.lovelace.editor.cardpicker.custom_card"
              )}: ${customCard.name || customCard.type}`
            : name}
        </div>
        <div
          class="preview ${classMap({
            description: !element || element.tagName === "HUI-ERROR-CARD",
          })}"
        >
          ${element && element.tagName !== "HUI-ERROR-CARD"
            ? element
            : customCard
            ? customCard.description ||
              this.hass!.localize(
                `ui.panel.lovelace.editor.cardpicker.no_description`
              )
            : description}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hui-card-picker": HuiCardPicker;
  }
}
