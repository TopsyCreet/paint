import type { Distributor, Product, Shade } from "../data/types";
import { describeTins, type TinPlan } from "./calc";

export interface OrderLine {
  shade: Shade;
  product: Product;
  plan: TinPlan;
  litres: number;
}

export function orderMessage(opts: {
  distributor: Distributor;
  lines: OrderLine[];
  customerArea?: string;
  brandName: string;
  money: (n: number) => string;
}): string {
  const { distributor, lines, customerArea, brandName, money } = opts;
  const body = lines
    .map((l) => {
      const tins = describeTins(l.plan) || "quantity to confirm";
      const est = l.plan.cost ? ` (about ${money(l.plan.cost)})` : "";
      return `• ${l.product.name} in ${l.shade.name} (${l.shade.code}): ${tins}${est}`;
    })
    .join("\n");
  return [
    `Hello ${distributor.name},`,
    "",
    "I'd like to order:",
    body,
    "",
    customerArea ? `I'm in ${customerArea}. Please confirm the price and when I can pick up or get delivery.` : "Please confirm the price and when I can pick up or get delivery.",
    "",
    `Sent from ${brandName}`,
  ].join("\n");
}

/** wa.me link. Without a number, WhatsApp asks the user to choose a chat. */
export function whatsappUrl(text: string, number?: string): string {
  const n = (number ?? "").replace(/[^0-9]/g, "");
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, "")}`;
}
