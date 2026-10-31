import type { CardControls } from "../purchases/controls";
import type { AirwallexClient } from "./client";

export interface IssuedCard {
  card_id: string;
  card_status: string;
  card_number?: string;
}

export interface Cardholder {
  cardholder_id: string;
  status: string;
}

/**
 * What the purchase agent needs from a card issuer. Every call can run on
 * behalf of a connected account (Kit 05), so a tenant's card and spend live
 * in that tenant's own Airwallex account.
 */
export interface CardIssuer {
  createCardholder(input: { email: string; firstName: string; lastName: string; onBehalfOf?: string }): Promise<Cardholder>;
  getCardholder(id: string, onBehalfOf?: string): Promise<Cardholder>;
  createCard(input: {
    requestId: string;
    cardholderId: string;
    createdBy: string;
    nickName: string;
    controls: CardControls;
    metadata: Record<string, string>;
    onBehalfOf?: string;
  }): Promise<IssuedCard>;
  setCardStatus(cardId: string, status: "ACTIVE" | "INACTIVE" | "CLOSED", onBehalfOf?: string): Promise<IssuedCard>;
}

export class AirwallexCardIssuer implements CardIssuer {
  constructor(private readonly client: AirwallexClient) {}

  createCardholder(input: { email: string; firstName: string; lastName: string; onBehalfOf?: string }) {
    // Synthetic sandbox identity for the business's delegate cardholder.
    return this.client.request<Cardholder>("POST", "/api/v1/issuing/cardholders/create", {
      onBehalfOf: input.onBehalfOf,
      body: {
        type: "DELEGATE",
        email: input.email,
        individual: {
          name: { first_name: input.firstName, last_name: input.lastName },
          date_of_birth: "1990-01-15",
          address: { line1: "1 Market Street", city: "San Francisco", state: "CA", country: "US", postcode: "94105" },
          express_consent_obtained: "yes",
        },
      },
    });
  }

  getCardholder(id: string, onBehalfOf?: string) {
    return this.client.request<Cardholder>("GET", `/api/v1/issuing/cardholders/${id}`, { onBehalfOf });
  }

  createCard(input: Parameters<CardIssuer["createCard"]>[0]) {
    return this.client.request<IssuedCard>("POST", "/api/v1/issuing/cards/create", {
      onBehalfOf: input.onBehalfOf,
      body: {
        request_id: input.requestId,
        cardholder_id: input.cardholderId,
        created_by: input.createdBy,
        form_factor: "VIRTUAL",
        is_personalized: false,
        program: { purpose: "COMMERCIAL" },
        nick_name: input.nickName.slice(0, 40),
        authorization_controls: input.controls,
        metadata: input.metadata,
      },
    });
  }

  setCardStatus(cardId: string, status: "ACTIVE" | "INACTIVE" | "CLOSED", onBehalfOf?: string) {
    return this.client.request<IssuedCard>("POST", `/api/v1/issuing/cards/${cardId}/update`, {
      onBehalfOf,
      body: { card_status: status },
    });
  }
}
