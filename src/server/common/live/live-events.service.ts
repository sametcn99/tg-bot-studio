import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/** Live change notification sent over SSE. */
export interface LiveEvent {
  data: { topic: string; botId: number; at: number };
}

/**
 * In-process live change bus powering Server-Sent Events streams. Model
 * layers emit coarse "something changed" notifications; the dashboard
 * refetches on ping, keeping payloads tiny and avoiding permission leaks.
 */
@Injectable()
export class LiveEventsService {
  private readonly subjects = new Map<string, Subject<LiveEvent>>();

  /**
   * Notifies subscribers that a bot-scoped topic changed.
   * @param {string} topic - Stream topic ('support' | 'broadcasts').
   * @param {number} botId - Bot whose data changed.
   * @returns {void}
   */
  emit(topic: string, botId: number): void {
    this.subjects.get(`${topic}:${botId}`)?.next({ data: { topic, botId, at: Date.now() } });
  }

  /**
   * Subscribes to change notifications for one bot + topic.
   * @param {string} topic - Stream topic.
   * @param {number} botId - Bot to observe.
   * @returns {Observable<LiveEvent>} Cold observable of pings.
   */
  stream(topic: string, botId: number): Observable<LiveEvent> {
    const key = `${topic}:${botId}`;
    let subject = this.subjects.get(key);
    if (!subject) {
      subject = new Subject<LiveEvent>();
      this.subjects.set(key, subject);
    }
    return subject.asObservable();
  }
}
