/**
 * Pure cart re-pricing for the Stars checkout chain. Extracted from the mini
 * apps service so the money-path logic is unit-testable without Prisma.
 */

/** One client-submitted cart line. */
export interface ClientCartItem {
  id: string;
  quantity: number;
}

/** One server-verified cart line (prices always re-read from the catalog). */
export interface VerifiedCartItem {
  id: string;
  title: string;
  price: number;
  quantity: number;
}

/**
 * Re-prices a client cart against the server-side catalog: unknown products
 * are dropped, quantities clamp to >= 1, prices come only from stored config,
 * and an empty result is an error — the client's submitted totals are never
 * trusted.
 * @param {string | null} configJson - Mini App config JSON (`products` array).
 * @param {Array<{id: string; quantity: number}>} clientItems - Client cart.
 * @returns {{verifiedItems: VerifiedCartItem[]; total: number}} Verified cart.
 * @throws {Error} When no client item matches a catalog product.
 */
export function verifyCatalogOrder(
  configJson: string | null,
  clientItems: Array<{ id: string; quantity: number }>,
): { verifiedItems: VerifiedCartItem[]; total: number } {
  let catalog: Array<{ id: string; title: string; price: number }> = [];
  if (configJson) {
    try {
      const parsed: unknown = JSON.parse(configJson);
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { products?: unknown }).products)
      ) {
        catalog = (parsed as { products: Array<{ id: string; title: string; price: number }> })
          .products;
      }
    } catch {
      catalog = [];
    }
  }

  const verifiedItems: VerifiedCartItem[] = [];
  let total = 0;

  for (const item of clientItems) {
    const product = catalog.find((p) => String(p.id) === String(item.id));
    if (!product) continue;
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const price = Math.max(0, Number(product.price) || 0);
    total += price * qty;
    verifiedItems.push({
      id: String(product.id),
      title: String(product.title ?? 'Item'),
      price,
      quantity: qty,
    });
  }

  if (verifiedItems.length === 0) {
    throw new Error('ORDER_NO_PRODUCTS');
  }
  return { verifiedItems, total };
}
