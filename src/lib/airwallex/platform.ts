import type { AirwallexClient } from "./client";

export interface Balance {
  currency: string;
  available_amount: number;
  total_amount: number;
}

export interface MoneyMovement {
  id: string;
  status: "NEW" | "PENDING" | "SETTLED" | "SUSPENDED" | "FAILED" | string;
}

export interface SellerIdentity {
  ein: string;
  person: { identificationType: "PASSPORT" | "DRIVERS_LICENCE" | "PERSONAL_ID" | "TAX_ID"; number: string; issuingCountry: string };
}

export interface SellerProfile {
  tenantId: string;
  businessName: string;
  industryCategoryCode: string;
  /** What the seller sells, up to 500 characters. Required by Airwallex. */
  description: string;
  /** Identity values come only from the operator's local identities file, never from code. */
  identity: SellerIdentity;
  /** Estimated monthly revenue in US dollars, required by Airwallex. */
  monthlyRevenue: number;
  email: string;
  person: { firstName: string; lastName: string };
  address: { line1: string; suburb: string; state: string; postcode: string };
}

/** Platform calls for Kits 05 and 08. Customer-scoped calls carry x-on-behalf-of. */
export interface PlatformGateway {
  createAccount(p: SellerProfile): Promise<{ id: string; status: string }>;
  /** Fills in business details on an account that has not been submitted yet. */
  updateAccount(id: string, p: SellerProfile): Promise<{ id: string; status: string }>;
  submitAccount(id: string): Promise<{ id: string; status: string }>;
  getAccount(id: string): Promise<{ id: string; status: string }>;
  createGlobalAccount(input: { requestId: string; onBehalfOf: string }): Promise<{ id: string }>;
  /** The platform's own Global Accounts, which receive buyer payments. */
  listGlobalAccounts(): Promise<{ id: string; status: string; currency?: string }[]>;
  balances(onBehalfOf?: string): Promise<Balance[]>;
  /** Platform wallet to a seller wallet: payouts, reserve releases and bridges. */
  transferToSeller(input: { requestId: string; destination: string; amount: number; currency: string; reason: string; reference: string }): Promise<MoneyMovement>;
  getTransfer(id: string): Promise<MoneyMovement>;
  /** Seller wallet to the platform: shortfall recovery, bridge repayment and fees. */
  chargeSeller(input: { requestId: string; source: string; amount: number; currency: string; reason: string; reference: string }): Promise<MoneyMovement>;
}

/** Sandbox-only steps for the platform kits. */
export interface PlatformSimulator {
  activateAccount(id: string): Promise<void>;
  deposit(input: { globalAccountId: string; amount: number; reference: string; onBehalfOf?: string }): Promise<{ id: string }>;
}

function addressOf(p: SellerProfile) {
  // Account addresses use address_line1 and suburb; other names are silently dropped.
  return { address_line1: p.address.line1, suburb: p.address.suburb, state: p.address.state, postcode: p.address.postcode, country_code: "US" };
}

function identification(id: SellerIdentity["person"]) {
  const base = { identification_type: id.identificationType, issuing_country_code: id.issuingCountry };
  switch (id.identificationType) {
    case "TAX_ID":
      return { ...base, tax_id: { type: "SSN", number: id.number } };
    case "PASSPORT":
      return { ...base, passport: { number: id.number } };
    case "DRIVERS_LICENCE":
      return { ...base, drivers_license: { number: id.number } };
    case "PERSONAL_ID":
      return { ...base, personal_id: { number: id.number } };
  }
}

function businessDetails(p: SellerProfile) {
  return {
    business_name: p.businessName,
    business_structure: "LIMITED_LIABILITY_COMPANY",
    contact_number: "4155550100",
    industry_category_code: p.industryCategoryCode,
    description_of_goods_or_services: p.description,
    operating_country: ["US"],
    // The guide: an EIN must be present before submit, or on-behalf-of transfers fail.
    business_identifiers: [{ type: "EIN", number: p.identity.ein, country_code: "US" }],
    registration_address: addressOf(p),
    account_usage: {
      product_reference: ["COLLECT_MARKETPLACE_PROCEEDS", "RECEIVE_TRANSFERS", "CREATE_CARDS"],
      estimated_monthly_revenue: { amount: String(p.monthlyRevenue), currency: "USD" },
    },
  };
}

export class AirwallexPlatformGateway implements PlatformGateway {
  constructor(private readonly client: AirwallexClient) {}

  updateAccount(id: string, p: SellerProfile) {
    return this.client.request<{ id: string; status: string }>("POST", `/api/v1/accounts/${id}/update`, {
      body: { account_details: { business_details: businessDetails(p) } },
    });
  }

  createAccount(p: SellerProfile) {
    const address = addressOf(p);
    return this.client.request<{ id: string; status: string }>("POST", "/api/v1/accounts/create", {
      body: {
        account_details: {
          legal_entity_type: "BUSINESS",
          business_details: businessDetails(p),
          // Include the business person at create: adding one later does not persist.
          business_person_details: [
            {
              first_name: p.person.firstName,
              last_name: p.person.lastName,
              date_of_birth: "1986-04-12",
              email: p.email,
              nationality: "US",
              residential_address: address,
              roles: ["BENEFICIAL_OWNER", "DIRECTOR", "AUTHORISED_PERSON"],
              identifications: { primary: identification(p.identity.person) },
            },
          ],
        },
        customer_agreements: {
          agreed_to_terms_and_conditions: true,
          agreed_to_data_usage: true,
          terms_and_conditions: { agreed_at: new Date().toISOString(), service_agreement_type: "FULL", device_data: { ip_address: "127.0.0.1", user_agent: "Treza AI sandbox onboarding" } },
        },
        primary_contact: { email: p.email },
        nickname: p.businessName,
        identifier: p.tenantId,
        metadata: { tenant_id: p.tenantId },
      },
    });
  }

  submitAccount(id: string) {
    return this.client.request<{ id: string; status: string }>("POST", `/api/v1/accounts/${id}/submit`, { body: {} });
  }

  getAccount(id: string) {
    return this.client.request<{ id: string; status: string }>("GET", `/api/v1/accounts/${id}`);
  }

  createGlobalAccount(input: { requestId: string; onBehalfOf: string }) {
    return this.client.request<{ id: string }>("POST", "/api/v1/global_accounts/create", {
      onBehalfOf: input.onBehalfOf,
      body: { request_id: input.requestId, country_code: "US", required_features: [{ currency: "USD", transfer_method: "LOCAL" }] },
    });
  }

  async listGlobalAccounts() {
    const res = await this.client.request<{ items: { id: string; status: string; required_features?: { currency: string }[] }[] }>(
      "GET",
      "/api/v1/global_accounts",
      { query: { page_size: 100 } },
    );
    return (res.items ?? []).map((g) => ({ id: g.id, status: g.status, currency: g.required_features?.[0]?.currency }));
  }

  balances(onBehalfOf?: string) {
    return this.client.request<Balance[]>("GET", "/api/v1/balances/current", { onBehalfOf });
  }

  transferToSeller(input: { requestId: string; destination: string; amount: number; currency: string; reason: string; reference: string }) {
    return this.client.request<MoneyMovement>("POST", "/api/v1/connected_account_transfers/create", {
      body: { request_id: input.requestId, destination: input.destination, amount: input.amount, currency: input.currency, reason: input.reason, reference: input.reference.slice(0, 140) },
    });
  }

  getTransfer(id: string) {
    return this.client.request<MoneyMovement>("GET", `/api/v1/connected_account_transfers/${id}`);
  }

  chargeSeller(input: { requestId: string; source: string; amount: number; currency: string; reason: string; reference: string }) {
    return this.client.request<MoneyMovement>("POST", "/api/v1/charges/create", {
      body: { request_id: input.requestId, source: input.source, amount: input.amount, currency: input.currency, reason: input.reason, reference: input.reference.slice(0, 140) },
    });
  }
}

export class AirwallexPlatformSimulator implements PlatformSimulator {
  constructor(private readonly client: AirwallexClient) {}

  async activateAccount(id: string) {
    await this.client.request("POST", `/api/v1/simulation/accounts/${id}/update_status`, { body: { next_status: "ACTIVE", force: true } });
  }

  deposit(input: { globalAccountId: string; amount: number; reference: string; onBehalfOf?: string }) {
    return this.client.request<{ id: string }>("POST", "/api/v1/simulation/deposit/create", {
      onBehalfOf: input.onBehalfOf,
      body: { global_account_id: input.globalAccountId, amount: input.amount, payer_name: "Marketplace buyers", reference: input.reference },
    });
  }
}
