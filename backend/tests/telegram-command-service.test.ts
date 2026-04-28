import { formatSubsList, toMonthlyAmount } from '../src/services/telegram-command-service';
import { Subscription } from '../src/types/subscription';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

var mockSingle = jest.fn();
var mockOrder = jest.fn(() => ({ single: mockSingle }));
var mockEqStatus = jest.fn(() => ({ order: mockOrder }));
var mockEqUser = jest.fn(() => ({ eq: mockEqStatus, single: mockSingle, order: mockOrder }));
var mockSelect = jest.fn(() => ({ eq: mockEqUser }));
var mockFrom = jest.fn(() => ({ select: mockSelect }));
var mockTrackDbRequest = jest.fn(() => jest.fn());

jest.mock('../src/config/database', () => ({
  get supabase() { return { from: mockFrom }; },
  get trackDbRequest() { return mockTrackDbRequest; },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    user_id: 'user-1',
    email_account_id: null,
    merchant_id: null,
    name: 'Netflix',
    provider: 'Netflix',
    price: 15,
    currency: 'USD',
    billing_cycle: 'monthly',
    status: 'active',
    next_billing_date: null,
    category: null,
    logo_url: null,
    website_url: null,
    renewal_url: null,
    notes: null,
    visibility: 'private',
    tags: [],
    expired_at: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    paused_at: null,
    resume_at: null,
    pause_reason: null,
    last_interaction_at: null,
    ...overrides,
  };
}

// ─── toMonthlyAmount ─────────────────────────────────────────────────────────

describe('toMonthlyAmount', () => {
  it('returns the price unchanged for monthly billing', () => {
    expect(toMonthlyAmount(15, 'monthly')).toBe(15);
  });

  it('divides by 12 for yearly billing', () => {
    expect(toMonthlyAmount(120, 'yearly')).toBe(10);
  });

  it('divides by 3 for quarterly billing', () => {
    expect(toMonthlyAmount(30, 'quarterly')).toBe(10);
  });
});

// ─── formatSubsList ──────────────────────────────────────────────────────────

describe('formatSubsList', () => {
  it('includes each subscription name and monthly cost', () => {
    const subs = [
      makeSub({ name: 'Netflix', price: 15, billing_cycle: 'monthly', currency: 'USD' }),
      makeSub({ id: 'sub-2', name: 'Spotify', price: 9.99, billing_cycle: 'monthly', currency: 'USD' }),
    ];

    const output = formatSubsList(subs);

    expect(output).toContain('Netflix');
    expect(output).toContain('Spotify');
    expect(output).toContain('15.00');
    expect(output).toContain('9.99');
  });

  it('normalises yearly price to monthly equivalent', () => {
    const subs = [makeSub({ name: 'iCloud', price: 120, billing_cycle: 'yearly', currency: 'USD' })];
    const output = formatSubsList(subs);
    expect(output).toContain('10.00');
  });

  it('normalises quarterly price to monthly equivalent', () => {
    const subs = [makeSub({ name: 'Adobe', price: 60, billing_cycle: 'quarterly', currency: 'USD' })];
    const output = formatSubsList(subs);
    expect(output).toContain('20.00');
  });

  it('shows total monthly spend for single currency', () => {
    const subs = [
      makeSub({ price: 10, billing_cycle: 'monthly', currency: 'USD' }),
      makeSub({ id: 'sub-2', price: 20, billing_cycle: 'monthly', currency: 'USD' }),
    ];
    const output = formatSubsList(subs);
    expect(output).toContain('30.00');
    expect(output).toContain('Total');
  });

  it('shows per-currency totals when subscriptions use different currencies', () => {
    const subs = [
      makeSub({ price: 10, billing_cycle: 'monthly', currency: 'USD' }),
      makeSub({ id: 'sub-2', price: 8, billing_cycle: 'monthly', currency: 'EUR' }),
    ];
    const output = formatSubsList(subs);
    expect(output).toContain('USD 10.00');
    expect(output).toContain('EUR 8.00');
  });

  it('includes subscription count in the header', () => {
    const subs = [
      makeSub(),
      makeSub({ id: 'sub-2', name: 'Spotify' }),
    ];
    const output = formatSubsList(subs);
    expect(output).toContain('(2)');
  });
});

// ─── Command handler integration (ctx mocking) ───────────────────────────────

describe('/subs command handler', () => {
  // Dynamically import so mocks are applied before module load
  let handleSubsCommand: typeof import('../src/services/telegram-command-service').handleSubsCommand;

  beforeAll(async () => {
    const mod = await import('../src/services/telegram-command-service');
    handleSubsCommand = mod.handleSubsCommand;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockTrackDbRequest.mockReturnValue(jest.fn());
  });

  function makeCtx(chatId: number | undefined, replyFn = jest.fn()): any {
    return {
      chat: chatId !== undefined ? { id: chatId } : undefined,
      reply: replyFn,
    };
  }

  it('replies with not-linked message when chat_id has no matching user', async () => {
    // getUserIdByChatId returns null
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEqUser });
    mockEqUser.mockReturnValue({ single: mockSingle });
    mockSingle.mockResolvedValue({ data: null, error: null });

    const reply = jest.fn();
    await handleSubsCommand(makeCtx(12345, reply));

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('not linked'));
  });

  it('replies with empty message when user has no active subscriptions', async () => {
    // First call: getUserIdByChatId → returns user
    mockSingle.mockResolvedValueOnce({ data: { id: 'user-1' }, error: null });

    // Second call: getActiveSubscriptions → returns empty array
    const mockOrderResult = jest.fn().mockResolvedValue({ data: [], error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: mockSingle }) }) };
      return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ order: mockOrderResult }) }) }) };
    });

    const reply = jest.fn();
    await handleSubsCommand(makeCtx(12345, reply));

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('no active subscriptions'));
  });

  it('replies with formatted list when user has active subscriptions', async () => {
    const activeSub = makeSub({ name: 'Netflix', price: 15, billing_cycle: 'monthly' });

    // Chain: profiles lookup → subscriptions lookup
    let profileCalled = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }) }),
          }),
        };
      }
      // subscriptions table
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({ data: [activeSub], error: null }),
            }),
          }),
        }),
      };
    });

    const reply = jest.fn();
    await handleSubsCommand(makeCtx(12345, reply));

    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('Netflix'),
      expect.objectContaining({ parse_mode: 'Markdown' })
    );
  });

  it('replies with error message when DB lookup throws', async () => {
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockRejectedValue(new Error('DB error')),
        }),
      }),
    }));

    const reply = jest.fn();
    await handleSubsCommand(makeCtx(12345, reply));

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('went wrong'));
  });
});
