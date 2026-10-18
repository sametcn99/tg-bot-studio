import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  PaymentEventsService,
  type StarsPaymentEvent,
} from '../../bot-engine/payment-events.service';
import { MiniAppsService } from './mini-apps.service';

/**
 * Fulfils Telegram Stars payments for Mini App orders: when the engine
 * receives `message:successful_payment`, orders in `pending_payment` state
 * transition to `paid` and the `order_paid` webhook fires.
 */
@Injectable()
export class StarsFulfilmentService implements OnModuleInit, OnModuleDestroy {
  private unsubscribe?: () => void;

  constructor(
    private readonly paymentEvents: PaymentEventsService,
    private readonly miniApps: MiniAppsService,
  ) {}

  /** Subscribes to the engine payment bus. */
  onModuleInit(): void {
    this.unsubscribe = this.paymentEvents.onPayment((event) =>
      this.handle(event).catch(() => undefined),
    );
  }

  /** Unsubscribes on shutdown. */
  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /**
   * Routes one payment event by invoice payload.
   * @param {StarsPaymentEvent} event - Payment details from the engine.
   * @returns {Promise<void>} Resolves after fulfilment.
   */
  private async handle(event: StarsPaymentEvent): Promise<void> {
    if (event.invoicePayload.startsWith('order:')) {
      const orderId = event.invoicePayload.slice('order:'.length);
      if (orderId) {
        await this.miniApps.markOrderPaid(orderId, event.telegramPaymentChargeId);
      }
    }
  }
}
