import React, { useEffect, useMemo, useRef, useState } from 'react';
import { tmaFetch } from '../api';
import {
  haptic,
  onBackButtonClick,
  setBackButtonVisible,
  setClosingConfirmation,
} from '../sdk/telegram';
import { createT } from '../i18n';
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
 * E-Commerce view stack entry: catalog root, a single product detail, or the
 * cart. The Telegram BackButton pops through this stack.
 * @typedef {object} EcommerceView
 */
type EcommerceView = { name: 'catalog' } | { name: 'product'; product: Product } | { name: 'cart' };

/**
 * Groups products by their optional `category` field, bucketing uncategorized
 * products under the localized "All" label.
 * @param {Product[]} products - Configured products.
 * @param {string} fallbackLabel - Label used for uncategorized products.
 * @returns {Array<[string, Product[]]>} Category buckets in insertion order.
 */
function groupByCategory(products: Product[], fallbackLabel: string): Array<[string, Product[]]> {
  const map = new Map<string, Product[]>();
  for (const product of products) {
    const category = (product as Product & { category?: string }).category ?? fallbackLabel;
    const bucket = map.get(category) ?? [];
    bucket.push(product);
    map.set(category, bucket);
  }
  return [...map.entries()];
}

/**
 * E-Commerce & Digital Storefront template: categorized catalog, product
 * detail, shopping cart, and checkout recorded as a Mini App order (Telegram
 * Stars by default). Wires the Telegram BackButton to in-app back navigation
 * and enables the closing confirmation while the cart holds items.
 * @param {object} props - Component props.
 * @param {TmaAppConfig} props.config - Loaded app configuration.
 * @returns {React.ReactElement} The storefront view.
 */
export default function Ecommerce({ config }: { config: TmaAppConfig }): React.ReactElement {
  const t = createT(config.config);
  const products = useMemo(
    () => (config.config.products as Product[]) ?? [],
    [config.config.products],
  );
  const allCategoryLabel = t('ecommerce.allCategory', 'All');
  const categories = groupByCategory(products, allCategoryLabel);

  const [activeCategory, setActiveCategory] = useState<string>(allCategoryLabel);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<EcommerceView>({ name: 'catalog' });
  const [history, setHistory] = useState<EcommerceView[]>([]);

  const cartItems = products.filter((product) => cart[product.id]);
  const cartCount = cartItems.reduce((sum, product) => sum + (cart[product.id] ?? 0), 0);
  const cartTotal = cartItems.reduce(
    (sum, product) => sum + product.price * (cart[product.id] ?? 0),
    0,
  );

  /**
   * Pushes the current view onto the history stack and navigates forward.
   * @param {EcommerceView} next - View to navigate to.
   * @returns {void}
   */
  function navigate(next: EcommerceView): void {
    setHistory((stack) => [...stack, view]);
    setView(next);
  }

  /**
   * Pops the previous view off the history stack. No-op at the catalog root.
   * @returns {void}
   */
  function goBack(): void {
    const previous = history[history.length - 1];
    if (!previous) return;
    setView(previous);
    setHistory((stack) => stack.slice(0, -1));
  }

  // Keep the BackButton handler pointed at the latest goBack closure without
  // re-subscribing on every render.
  const goBackRef = useRef(goBack);
  useEffect(() => {
    goBackRef.current = goBack;
  });

  // BackButton is visible on every view except the catalog root.
  useEffect(() => {
    setBackButtonVisible(view.name !== 'catalog');
  }, [view.name]);

  useEffect(() => {
    return onBackButtonClick(() => goBackRef.current());
  }, []);

  // Ask for confirmation before closing while the cart holds items.
  useEffect(() => {
    setClosingConfirmation(cartCount > 0);
    return () => setClosingConfirmation(false);
  }, [cartCount]);

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
   * Removes a product from the cart entirely.
   * @param {Product} product - Product to remove.
   * @returns {void}
   */
  function removeFromCart(product: Product): void {
    setCart((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });
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
        setStatus(
          t(
            'ecommerce.paymentsRequireTelegram',
            'Payments require Telegram. Open this app inside Telegram to check out.',
          ),
        );
        return;
      }

      const invoiceStatus = await new Promise<string>((resolve) => {
        tg.openInvoice!(result.invoiceLink, (closedStatus: string) => resolve(closedStatus));
      });

      if (invoiceStatus !== 'paid') {
        setStatus(
          t('ecommerce.paymentNotCompleted', 'Payment not completed ({status}).', {
            status: invoiceStatus,
          }),
        );
        return;
      }

      // Confirm server-side status (webhook-level fulfilment may lag briefly).
      let orderStatus = 'pending_payment';
      for (let attempt = 0; attempt < 6 && orderStatus === 'pending_payment'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const order = await tmaFetch<{ status: string } | null>(
          `/api/tma/${config.slug}/order/${result.orderId}`,
        );
        orderStatus = order?.status ?? orderStatus;
      }
      haptic('medium');
      setCart({});
      setStatus(
        orderStatus === 'paid'
          ? t('ecommerce.paymentReceived', 'Payment received — thank you! 🎉')
          : t('ecommerce.orderStatus', 'Order status: {status}', { status: orderStatus }),
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : t('ecommerce.checkoutFailed', 'Checkout failed'),
      );
    } finally {
      setBusy(false);
    }
  }

  const visible = products.filter(
    (product) => (product as Product & { category?: string }).category === activeCategory,
  );

  const catalogView = (
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
          <div
            key={product.id}
            className="card product-card"
            onClick={() => navigate({ name: 'product', product })}
          >
            {product.imageUrl ? (
              <img className="product-image" src={product.imageUrl} alt={product.title} />
            ) : null}
            <div style={{ marginTop: 8, fontWeight: 600 }}>{product.title}</div>
            <div className="muted">{product.description}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="badge">{product.price}</span>
              <button
                className="secondary"
                style={{ width: 'auto', padding: '6px 12px' }}
                onClick={(event) => {
                  event.stopPropagation();
                  addToCart(product);
                }}
              >
                {t('ecommerce.add', 'Add')}
              </button>
            </div>
          </div>
        ))}
        {products.length === 0 && (
          <div className="state-message" style={{ gridColumn: '1 / -1' }}>
            {t('ecommerce.noProducts', 'No products configured yet.')}
          </div>
        )}
      </div>
    </>
  );

  const productView = view.name === 'product' && (
    <div className="product-detail">
      {view.product.imageUrl ? (
        <img className="product-image" src={view.product.imageUrl} alt={view.product.title} />
      ) : null}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{view.product.title}</div>
        <div className="muted">{view.product.description}</div>
        <div className="row">
          <span className="badge">{view.product.price}</span>
        </div>
        <button className="primary" onClick={() => addToCart(view.product)}>
          {t('ecommerce.add', 'Add')}
        </button>
      </div>
    </div>
  );

  const cartView = (
    <div className="cart-items">
      {cartItems.length === 0 ? (
        <div className="state-message">{t('ecommerce.cartEmpty', 'Your cart is empty.')}</div>
      ) : (
        cartItems.map((product) => (
          <div key={product.id} className="cart-item">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{product.title}</div>
              <div className="muted">
                {product.price} × {cart[product.id]}
              </div>
            </div>
            <div className="qty-controls">
              <button
                className="secondary"
                aria-label="-"
                onClick={() => {
                  if (cart[product.id] <= 1) {
                    removeFromCart(product);
                  } else {
                    setCart((current) => ({
                      ...current,
                      [product.id]: (current[product.id] ?? 0) - 1,
                    }));
                  }
                }}
              >
                −
              </button>
              <span>{cart[product.id]}</span>
              <button className="secondary" aria-label="+" onClick={() => addToCart(product)}>
                +
              </button>
            </div>
          </div>
        ))
      )}
      {cartItems.length > 0 && (
        <button className="primary" onClick={() => void checkout()} disabled={busy}>
          {busy ? t('common.processing', 'Processing...') : t('ecommerce.checkout', 'Checkout')}
        </button>
      )}
    </div>
  );

  return (
    <>
      {view.name === 'catalog' && catalogView}
      {productView}
      {view.name === 'cart' && cartView}

      {view.name !== 'cart' && cartItems.length > 0 && (
        <div className="cart-bar">
          <div>
            <div className="muted">{t('ecommerce.cart', 'Cart')}</div>
            <div style={{ fontWeight: 700 }}>{cartTotal}</div>
          </div>
          <button className="primary" onClick={() => navigate({ name: 'cart' })}>
            {t('ecommerce.viewCart', 'View cart')}
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
