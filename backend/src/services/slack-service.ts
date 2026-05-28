import logger from '../config/logger';
import { NotificationPayload, DeliveryResult } from '../types/reminder';
import { sanitizeUrl } from '../utils/sanitize-url';
import { NonRetryableError, RetryableError, withRetry } from '../utils/retry';

export interface SlackServiceStatus {
  configured: boolean;
  webhookUrlConfigured: boolean;
  webhookHost: string | null;
}

export class SlackService {
  private readonly webhookUrl: string;

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl || process.env.SLACK_WEBHOOK_URL || '';
  }

  isConfigured(): boolean {
    return Boolean(this.webhookUrl);
  }

  getStatus(): SlackServiceStatus {
    let webhookHost: string | null = null;

    if (this.webhookUrl) {
      try {
        webhookHost = new URL(this.webhookUrl).host;
      } catch {
        webhookHost = null;
      }
    }

    return {
      configured: this.isConfigured(),
      webhookUrlConfigured: this.isConfigured(),
      webhookHost,
    };
  }

  async sendReminderNotification(
    payload: NotificationPayload,
    options: { maxAttempts?: number } = {},
  ): Promise<DeliveryResult> {
    const { maxAttempts = 3 } = options;

    if (!this.webhookUrl) {
      return {
        success: false,
        error: 'Slack webhook URL is not configured',
        metadata: { retryable: false },
      };
    }

    try {
      return await withRetry(
        async () => {
          const response = await fetch(this.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.buildMessage(payload)),
          });

          if (!response.ok) {
            const responseText = await response.text();
            const errorMessage = `Slack webhook responded with ${response.status}`;
            const retryable = response.status === 429 || response.status >= 500;

            if (retryable) {
              throw new RetryableError(`${errorMessage}: ${responseText.slice(0, 200)}`);
            }

            throw new NonRetryableError(`${errorMessage}: ${responseText.slice(0, 200)}`);
          }

          logger.info('Slack notification sent successfully', {
            subscriptionId: payload.subscription.id,
            reminderType: payload.reminderType,
          });

          return {
            success: true,
            metadata: {
              status: response.status,
              channel: 'slack',
            },
          };
        },
        { maxAttempts },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to send Slack notification:', errorMessage);

      return {
        success: false,
        error: errorMessage,
        metadata: { retryable: this.isRetryableError(error) },
      };
    }
  }

  async sendCustomMessage(
    text: string,
    options: { maxAttempts?: number } = {},
  ): Promise<DeliveryResult> {
    const { maxAttempts = 3 } = options;

    if (!this.webhookUrl) {
      return {
        success: false,
        error: 'Slack webhook URL is not configured',
        metadata: { retryable: false },
      };
    }

    try {
      return await withRetry(
        async () => {
          const response = await fetch(this.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });

          if (!response.ok) {
            const responseText = await response.text();
            const retryable = response.status === 429 || response.status >= 500;
            const errorMessage = `Slack webhook responded with ${response.status}: ${responseText.slice(0, 200)}`;

            if (retryable) {
              throw new RetryableError(errorMessage);
            }

            throw new NonRetryableError(errorMessage);
          }

          return {
            success: true,
            metadata: { status: response.status, channel: 'slack' },
          };
        },
        { maxAttempts },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        error: errorMessage,
        metadata: { retryable: this.isRetryableError(error) },
      };
    }
  }

  private buildMessage(payload: NotificationPayload): { text: string; blocks: Array<Record<string, unknown>> } {
    const subscriptionUrl = payload.subscription.renewal_url
      ? sanitizeUrl(payload.subscription.renewal_url)
      : null;

    const summary = this.buildSummary(payload);
    const blocks: Array<Record<string, unknown>> = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: summary.title,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: summary.body,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Subscription:*\n${payload.subscription.name}` },
          { type: 'mrkdwn', text: `*Due in:*\n${payload.daysBefore} day${payload.daysBefore === 1 ? '' : 's'}` },
          { type: 'mrkdwn', text: `*Renewal date:*\n${new Date(payload.renewalDate).toLocaleDateString('en-US')}` },
          { type: 'mrkdwn', text: `*Channel:*\nSlack` },
        ],
      },
    ];

    if (subscriptionUrl && subscriptionUrl !== '#') {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open subscription' },
            url: subscriptionUrl,
          },
        ],
      });
    }

    return {
      text: `${summary.title} ${summary.body}`,
      blocks,
    };
  }

  private buildSummary(payload: NotificationPayload): { title: string; body: string } {
    if (payload.reminderType === 'trial_expiry') {
      return {
        title: `Trial ending soon: ${payload.subscription.name}`,
        body: `${payload.subscription.name} trial ends in ${payload.daysBefore} day${payload.daysBefore === 1 ? '' : 's'}.`,
      };
    }

    return {
      title: `Renewal reminder: ${payload.subscription.name}`,
      body: `${payload.subscription.name} renews in ${payload.daysBefore} day${payload.daysBefore === 1 ? '' : 's'}.`,
    };
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof NonRetryableError) {
      return false;
    }

    if (error instanceof RetryableError) {
      return true;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return [
      /timeout/i,
      /network/i,
      /connection/i,
      /econnrefused/i,
      /etimedout/i,
      /temporary/i,
      /rate limit/i,
      /503/i,
      /502/i,
      /504/i,
    ].some((pattern) => pattern.test(errorMessage));
  }
}

export const slackService = new SlackService();

export async function sendSlackAlert(webhookUrl: string, text: string): Promise<void> {
  const service = new SlackService(webhookUrl);
  const result = await service.sendCustomMessage(text, { maxAttempts: 1 });

  if (!result.success) {
    logger.warn('Slack webhook returned a non-success result', {
      error: result.error,
      retryable: result.metadata?.retryable,
    });
  }
}
