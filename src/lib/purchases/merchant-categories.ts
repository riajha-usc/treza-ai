/** Merchant category codes the demo understands, with plain names for people and models. */
export const MERCHANT_CATEGORIES: Record<string, string> = {
  "5734": "Computer software stores",
  "5817": "Digital goods: software applications",
  "7372": "Computer programming and data processing",
  "4816": "Computer network and information services",
  "5045": "Computers and computer peripheral equipment",
  "5943": "Office and stationery supplies",
  "4215": "Courier services",
  "7311": "Advertising services",
  "5812": "Restaurants",
  "7995": "Betting and gambling",
};

export function categoryName(code: string): string {
  return MERCHANT_CATEGORIES[code] ?? `Category ${code}`;
}
