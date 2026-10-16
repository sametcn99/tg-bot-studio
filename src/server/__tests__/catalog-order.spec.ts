import { describe, expect, it } from 'bun:test';
import { verifyCatalogOrder } from '../modules/mini-apps/catalog-order.util';

const catalog = JSON.stringify({
  products: [
    { id: 'p1', title: 'Mug', price: 10 },
    { id: 'p2', title: 'Shirt', price: '25' },
  ],
});

describe('Stars cart re-pricing (server-authoritative)', () => {
  it('re-prices every line from the stored catalog, ignoring client totals', () => {
    const { verifiedItems, total } = verifyCatalogOrder(catalog, [
      { id: 'p1', quantity: 2 },
      { id: 'p2', quantity: 1 },
    ]);
    expect(verifiedItems).toHaveLength(2);
    expect(verifiedItems[0].price).toBe(10);
    expect(verifiedItems[1].price).toBe(25);
    expect(total).toBe(45);
  });

  it('drops unknown product ids instead of trusting them', () => {
    const { verifiedItems, total } = verifyCatalogOrder(catalog, [
      { id: 'p1', quantity: 1 },
      { id: 'ghost-product', quantity: 99 },
    ]);
    expect(verifiedItems).toHaveLength(1);
    expect(total).toBe(10);
  });

  it('clamps quantities to a minimum of one', () => {
    const { verifiedItems, total } = verifyCatalogOrder(catalog, [
      { id: 'p1', quantity: 0 },
      { id: 'p2', quantity: -5 },
    ]);
    expect(verifiedItems[0].quantity).toBe(1);
    expect(verifiedItems[1].quantity).toBe(1);
    expect(total).toBe(35);
  });

  it('clamps negative catalog prices to zero', () => {
    const hostile = JSON.stringify({ products: [{ id: 'x', title: 'X', price: -50 }] });
    const { total } = verifyCatalogOrder(hostile, [{ id: 'x', quantity: 3 }]);
    expect(total).toBe(0);
  });

  it('rejects a cart with no resolvable products', () => {
    expect(() => verifyCatalogOrder(catalog, [{ id: 'nope', quantity: 1 }])).toThrow(
      'ORDER_NO_PRODUCTS',
    );
  });

  it('rejects anything against a corrupt catalog', () => {
    expect(() => verifyCatalogOrder('{corrupt', [{ id: 'p1', quantity: 1 }])).toThrow(
      'ORDER_NO_PRODUCTS',
    );
  });
});
