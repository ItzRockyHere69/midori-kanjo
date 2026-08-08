import type { Item } from "./db";

const roundValue = (value: number) => Math.round(value * 100) / 100;

export type ItemProfitMetrics = {
  costKnown: boolean;
  purchasePrice: number;
  sellingPrice: number;
  profit: number | null;
  marginPercent: number | null;
};

export function itemProfitMetrics(
  item: Pick<Item, "purchasePrice" | "priceWholesale">,
): ItemProfitMetrics {
  const purchasePrice = Math.max(0, Number(item.purchasePrice) || 0);
  const sellingPrice = Math.max(0, Number(item.priceWholesale) || 0);
  const costKnown = purchasePrice > 0;
  if (!costKnown || sellingPrice <= 0)
    return {
      costKnown,
      purchasePrice,
      sellingPrice,
      profit: null,
      marginPercent: null,
    };
  const profit = roundValue(sellingPrice - purchasePrice);
  return {
    costKnown,
    purchasePrice,
    sellingPrice,
    profit,
    marginPercent: roundValue((profit / sellingPrice) * 100),
  };
}
