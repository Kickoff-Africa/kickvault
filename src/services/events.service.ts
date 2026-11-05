import { createHmac, randomUUID } from 'node:crypto';
import { prisma } from '../config/database.js';
import { decrypt } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { assertResolvesPublic } from '../lib/url-safety.js';

export const WEBHOOK_EVENTS = [
  'credential.created',
  'credential.revealed',
  'credential.deleted',
  'asset.created',
  'asset.status_changed',
  'asset.deleted',
  'alert.triggered',
  'user.invited',
  'user.deactivated',
  'request.approved',
  'request.denied',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

let _fetch: typeof fetch = fetch;
/** Test hook. */
export function setEventFetch(f: typeof fetch): void {
  _fetch = f;
}

const DELIVERY_TIMEOUT_MS = 5_000;

async function deliver(
  webhook: { id: string; url: string; secret: string },
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify({ id: randomUUID(), event, createdAt: new Date().toISOString(), data });
  const signature = createHmac('sha256', webhook.secret).update(body).digest('hex');
  let code: number | null = null;
  try {
    const url = new URL(webhook.url);
    await assertResolvesPublic(url);
    const res = await _fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KickVault-Event': event,
        'X-KickVault-Signature': `sha256=${signature}`,
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    code = res.status;
  } catch (err) {
    logger.warn({ err, webhookId: webhook.id, event }, 'Webhook delivery failed');
    code = 0;
  }
  await prisma.webhook
    .update({ where: { id: webhook.id }, data: { lastDeliveryAt: new Date(), lastDeliveryCode: code } })
    .catch(() => undefined);
}

async function postChatMessage(text: string): Promise<void> {
  const integrations = await prisma.integration.findMany();
  await Promise.all(
    integrations.map(async (i) => {
      try {
        const [encryptedValue, iv, authTag, keyVersion] = i.webhookUrlEnc.split('.');
        const url = decrypt({ encryptedValue, iv, authTag, keyVersion: Number(keyVersion) });
        await assertResolvesPublic(new URL(url));
        // Slack and Teams incoming webhooks both accept {"text": "..."}.
        await _fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          redirect: 'manual',
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });
      } catch (err) {
        logger.warn({ err, provider: i.provider }, 'Chat notification failed');
      }
    }),
  );
}

/** Fire-and-forget: deliver an event to every active webhook subscribed to it. Never throws. */
export function emitEvent(event: WebhookEvent, data: Record<string, unknown>, chatText?: string): void {
  void (async () => {
    const hooks = await prisma.webhook.findMany({
      where: { active: true, events: { has: event } },
      select: { id: true, url: true, secret: true },
    });
    await Promise.all(hooks.map((h) => deliver(h, event, data)));
    if (chatText) await postChatMessage(chatText);
  })().catch((err) => logger.error({ err, event }, 'emitEvent failed'));
}
