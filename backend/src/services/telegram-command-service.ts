import { Telegraf, Context } from 'telegraf';
import { randomUUID } from 'crypto';
import logger from '../config/logger';
import { supabase, trackDbRequest } from '../config/database';
import { Subscription } from '../types/subscription';

// ─── Monthly Cost Normalisation ───────────────────────────────────────────────

const CYCLE_DIVISOR: Record<Subscription['billing_cycle'], number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

function toMonthlyAmount(price: number, cycle: Subscription['billing_cycle']): number {
  return price / CYCLE_DIVISOR[cycle];
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatSubsList(subs: Subscription[]): string {
  const lines = subs.map((s) => {
    const monthly = toMonthlyAmount(s.price, s.billing_cycle);
    return `• *${escapeMarkdown(s.name)}* — ${s.currency} ${monthly.toFixed(2)}/mo`;
  });

  const total = subs.reduce(
    (sum, s) => sum + toMonthlyAmount(s.price, s.billing_cycle),
    0
  );

  // Group currencies — if mixed, show per-currency totals; otherwise show single total
  const currencies = [...new Set(subs.map((s) => s.currency))];
  let totalLine: string;

  if (currencies.length === 1) {
    totalLine = `\n💳 *Total:* ${currencies[0]} ${total.toFixed(2)}/mo`;
  } else {
    const perCurrency = currencies.map((cur) => {
      const curTotal = subs
        .filter((s) => s.currency === cur)
        .reduce((sum, s) => sum + toMonthlyAmount(s.price, s.billing_cycle), 0);
      return `${cur} ${curTotal.toFixed(2)}`;
    });
    totalLine = `\n💳 *Total:* ${perCurrency.join(' + ')}/mo`;
  }

  return (
    `📋 *Your Active Subscriptions* (${subs.length})\n\n` +
    lines.join('\n') +
    totalLine
  );
}

/** Escape characters that have special meaning in Telegram Markdown v1. */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function getUserIdByChatId(chatId: string): Promise<string | null> {
  const release = trackDbRequest();
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_chat_id', chatId)
      .single();

    if (error || !data?.id) return null;
    return data.id as string;
  } finally {
    release();
  }
}

async function getActiveSubscriptions(userId: string): Promise<Subscription[]> {
  const release = trackDbRequest();
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id, name, price, currency, billing_cycle, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('name', { ascending: true });

    if (error) throw error;
    return (data as Subscription[]) ?? [];
  } finally {
    release();
  }
}

// ─── Command Handler ──────────────────────────────────────────────────────────

async function handleSubsCommand(ctx: Context): Promise<void> {
  const requestId = randomUUID();
  const chatId = String(ctx.chat?.id);

  logger.info('[TelegramCommandService] /subs command received', { requestId, chatId });

  let userId: string | null;
  try {
    userId = await getUserIdByChatId(chatId);
  } catch (err) {
    logger.error('[TelegramCommandService] DB error looking up user', {
      requestId,
      chatId,
      error: (err as Error).message,
    });
    await ctx.reply('⚠️ Something went wrong. Please try again later.');
    return;
  }

  if (!userId) {
    await ctx.reply(
      '🔗 Your Telegram account is not linked to a SYNCRO account.\n\n' +
        'Log in to SYNCRO and connect Telegram in your notification settings.'
    );
    return;
  }

  let subs: Subscription[];
  try {
    subs = await getActiveSubscriptions(userId);
  } catch (err) {
    logger.error('[TelegramCommandService] DB error fetching subscriptions', {
      requestId,
      userId,
      error: (err as Error).message,
    });
    await ctx.reply('⚠️ Could not load your subscriptions. Please try again later.');
    return;
  }

  if (subs.length === 0) {
    await ctx.reply('📭 You have no active subscriptions tracked in SYNCRO.');
    return;
  }

  const message = formatSubsList(subs);
  await ctx.reply(message, { parse_mode: 'Markdown' });

  logger.info('[TelegramCommandService] /subs reply sent', {
    requestId,
    userId,
    count: subs.length,
  });
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class TelegramCommandService {
  private bot: Telegraf | null = null;

  /** Initialises the Telegraf bot and registers command handlers. */
  init(): Telegraf | null {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      logger.warn(
        '[TelegramCommandService] TELEGRAM_BOT_TOKEN not set — command bot disabled'
      );
      return null;
    }

    this.bot = new Telegraf(token);
    this.bot.command('subs', handleSubsCommand);

    logger.info('[TelegramCommandService] Command handlers registered');
    return this.bot;
  }

  /** Returns the underlying Telegraf instance (null if not initialised). */
  getBot(): Telegraf | null {
    return this.bot;
  }

  /**
   * Starts long-polling. Use this only in development/environments without a
   * public HTTPS URL for webhooks.
   */
  async startPolling(): Promise<void> {
    if (!this.bot) return;
    await this.bot.launch();
    logger.info('[TelegramCommandService] Long-polling started');
  }

  /** Gracefully stops polling. */
  stop(): void {
    this.bot?.stop();
  }
}

export const telegramCommandService = new TelegramCommandService();

// Exported for unit tests
export { handleSubsCommand, formatSubsList, toMonthlyAmount, getUserIdByChatId, getActiveSubscriptions };
