import { AirwallexError } from "@/lib/airwallex/client";
import type { Balance, MoneyMovement, PlatformGateway, PlatformSimulator, SellerProfile } from "@/lib/airwallex/platform";

/** A platform with a pre-funded wallet and one wallet per seller, like the sandbox. */
export class FakePlatform implements PlatformGateway, PlatformSimulator {
  accounts = new Map<string, { status: string; profile: SellerProfile }>();
  wallets = new Map<string, number>([["platform", 1_000_000_000]]);
  globalAccounts = new Map<string, string>([["ga_platform", "platform"]]);
  movements = new Map<string, MoneyMovement & { reads: number }>();
  transfers: { destination: string; amount: number }[] = [];
  charges: { source: string; amount: number }[] = [];
  private seq = 0;

  private move(from: string, to: string, amount: number) {
    const cents = Math.round(amount * 100);
    if ((this.wallets.get(from) ?? 0) < cents) throw new AirwallexError(400, "insufficient_fund", "Insufficient funds");
    this.wallets.set(from, (this.wallets.get(from) ?? 0) - cents);
    this.wallets.set(to, (this.wallets.get(to) ?? 0) + cents);
  }
  private record(prefix: string): MoneyMovement {
    const m = { id: `${prefix}_${++this.seq}`, status: "NEW", reads: 0 };
    this.movements.set(m.id, m);
    return { id: m.id, status: m.status };
  }

  async createAccount(p: SellerProfile) {
    const id = `acct_${++this.seq}`;
    this.accounts.set(id, { status: "CREATED", profile: p });
    this.wallets.set(id, 0);
    return { id, status: "CREATED" };
  }
  async updateAccount(id: string) {
    return { id, status: this.accounts.get(id)!.status };
  }
  async submitAccount(id: string) {
    this.accounts.get(id)!.status = "SUBMITTED";
    return { id, status: "SUBMITTED" };
  }
  async activateAccount(id: string) {
    this.accounts.get(id)!.status = "ACTIVE";
  }
  async getAccount(id: string) {
    return { id, status: this.accounts.get(id)!.status };
  }
  async createGlobalAccount(input: { onBehalfOf: string }) {
    const id = `ga_${input.onBehalfOf}`;
    this.globalAccounts.set(id, input.onBehalfOf);
    return { id };
  }
  async listGlobalAccounts() {
    return [{ id: "ga_platform", status: "ACTIVE", currency: "USD" }];
  }
  async deposit(input: { globalAccountId: string; amount: number }) {
    const owner = this.globalAccounts.get(input.globalAccountId)!;
    this.wallets.set(owner, (this.wallets.get(owner) ?? 0) + Math.round(input.amount * 100));
    return { id: `dep_${++this.seq}` };
  }
  async balances(onBehalfOf?: string): Promise<Balance[]> {
    const cents = this.wallets.get(onBehalfOf ?? "platform") ?? 0;
    return [{ currency: "USD", available_amount: cents / 100, total_amount: cents / 100 }];
  }
  async transferToSeller(input: { destination: string; amount: number }) {
    this.move("platform", input.destination, input.amount);
    this.transfers.push(input);
    return this.record("cat");
  }
  async getTransfer(id: string) {
    const m = this.movements.get(id)!;
    m.status = "SETTLED"; // Settles on the first read back.
    return { id, status: m.status };
  }
  async chargeSeller(input: { source: string; amount: number }) {
    this.move(input.source, "platform", input.amount);
    this.charges.push(input);
    return this.record("chg");
  }
}
