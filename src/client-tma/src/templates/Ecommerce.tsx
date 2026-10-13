import React, { useMemo, useState } from 'react';
import { tmaFetch } from '../api';
import { haptic } from '../sdk/telegram';
import type { TmaAppConfig } from '../App';

/**
 * Catalog product definition from the E-Commerce template config.
 * @interface Product
 * @property {string} id - Product identifier.
 * @property {string} title - Display title.
 * @property {number} price - Price in the configured currency.
 * @property {string} [imageUrl] - Product photo URL.
 * @property {string} [description] - Short description.
 */
interface Product {
  id: string;
  title: string;
  price: number;
  imageUrl?: string;
  description?: string;
}

/**
 * E-Commerce & Digital Storefront template: categorized catalog, shopping
 * cart, and checkout recorded as a Mini App order (Telegram Stars by default).
 * @param {object} props - Component props.
 * @param {TmaAppConfig} props.config - Loaded app configuration.
 * @returns {React.ReactElement} The storefront view.
 */
export default function Ecommerce({ config }: { config: TmaAppConfig }): React.ReactElement {
  const products = useMemo(
    () => (config.config.products as Product[]) ?? [],
    [config.config.products],
  );
  const categories = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const product of products) {
      const category = (product as Product & { category?: string }).category ?? 'All';
      const bucket = map.get(category) ?? [];
      bucket.push(product);
      map.set(category, bucket);
    }
    return [...map.entries()];
  }, [products]);

  const [activeCategory, setActiveCategory] = useState<string>(categories[0]?.[0] ?? 'All');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cartItems = products.filter((product) => cart[product.id]);
  const cartTotal = cartItems.reduce(
    (sum, product) => sum + product.price * (cart[product.id] ?? 0),
    0,
  );

  /**
   * Adds one unit of a product to the cart.
   * @param {Product} product - Product to add.
   * @returns {void}
   */
  function addToCart(product: Product): void {
    haptic('light');
    setCart((current) => ({ ...current, [product.id]: (current[product.id] ?? 0) + 1 }));
  }

  /**
   * Submits the cart as a Telegram Stars invoice, opens it, and polls the
   * order status until paid or failed.
   * @returns {Promise<void>} Resolves after the status settles.
   */
  async function checkout(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      const items = cartItems.map((product) => ({
        id: product.id,
        quantity: cart[product.id] ?? 0,
      }));
      const result = await tmaFetch<{ orderId: number; invoiceLink: string }>(
        `/api/tma/${config.slug}/checkout`,
        { method: 'POST', body: JSON.stringify({ items }) },
      );

      const tg = (
        window as unknown as {
          Telegram?: {
            WebApp?: { openInvoice?: (url: string, callback?: (status: string) => void) => void };
          };
        }
      ).Telegram?.WebApp;
      if (!tg?.openInvoice) {
        setStatus('Payments require Telegram. Open this app inside Telegram to check out.');
        return;
      }

      const invoiceStatus = await new Promise<string>((resolve) => {
        tg.openInvoice!(result.invoiceLink, (closedStatus: string) => resolve(closedStatus));
      });

      if (invoiceStatus !== 'paid') {
        setStatus(`Payment not completed (${invoiceStatus}).`);
        return;
      }

      // Confirm server-side status (webhook-level fulfilment may lag briefly).
      let status = 'pending_payment';
      for (let attempt = 0; attempt < 6 && status === 'pending_payment'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const order = await tmaFetch<{ status: string } | null>(
          `/api/tma/${config.slug}/order/${result.orderId}`,
        );
        status = order?.status ?? status;
      }
      haptic('medium');
      setCart({});
      setStatus(status === 'paid' ? 'Payment received — thank you! 🎉' : `Order status: ${status}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Checkout failed');
    } finally {
      setBusy(false);
    }
  }

  const visible = products.filter(
    (product) => (product as Product & { category?: string }).category === activeCategory,
  );

  return (
    <>
      {categories.length > 1 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {categories.map(([category]) => (
            <button
              key={category}
              className={category === activeCategory ? 'primary' : 'secondary'}
              style={{ width: 'auto', padding: '6px 12px' }}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>
      )}

      <div className="grid">
        {(visible.length > 0 ? visible : products).map((product) => (
          <div key={product.id} className="card">
            {product.imageUrl ? (
              <img className="product-image" src={product.imageUrl} alt={product.title} />
            ) : null}
            <div style={{ marginTop: 8, fontWeight: 600 }}>{product.title}</div>
            <div className="muted">{product.description}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="badge">{product.price}</span>
              <button
                className="secondary"
                style={{ padding: '6px 12px' }}
                onClick={() => addToCart(product)}
              >
                Add
              </button>
            </div>
          </div>
        ))}
        {products.length === 0 && (
          <div className="state-message" style={{ gridColumn: '1 / -1' }}>
            No products configured yet.
          </div>
        )}
      </div>

      {cartItems.length > 0 && (
        <div className="cart-bar">
          <div>
            <div className="muted">Cart</div>
            <div style={{ fontWeight: 700 }}>{cartTotal}</div>
          </div>
          <button className="primary" onClick={() => void checkout()} disabled={busy}>
            {busy ? 'Processing...' : 'Checkout'}
          </button>
        </div>
      )}
      {status && (
        <div className="success-text" role="status" aria-live="polite">
          {status}
        </div>
      )}
    </>
  );
}
