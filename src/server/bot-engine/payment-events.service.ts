import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/** Payload emitted for every successful Telegram Stars payment. */
export interface StarsPaymentEvent {
  botId: number;
  telegramId: number;
  /** Invoice payload string (`order:<id>` or `vip:<...>`). */
  invoicePayload: string;
  telegramPaymentChargeId: string;
  totalAmount: number;
  currency: string;
}

/**
 * Tiny in-process event bus decoupling the bot engine (which receives
 * Telegram payment updates) from feature modules (which fulfil them).
 * Feature modules subscribe on init; no cross-module imports are needed.
 */
@Injectable()
export class PaymentEventsService {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  /**
   * Publishes a Stars payment for asynchronous fulfilment.
   * @param {StarsPaymentEvent} event - Payment details.
   * @returns {void}
   */
  emitPayment(event: StarsPaymentEvent): void {
    this.emitter.emit('stars:payment', event);
  }

  /**
   * Subscribes to Stars payments.
   * @param {(event: StarsPaymentEvent) => void | Promise<void>} handler - Fulfilment callback.
   * @returns {() => void} Unsubscribe function.
   */
  onPayment(handler: (event: StarsPaymentEvent) => void | Promise<void>): () => void {
    this.emitter.on('stars:payment', handler);
    return () => this.emitter.off('stars:payment', handler);
  }
}
