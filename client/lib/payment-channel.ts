const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface PaymentChannel {
  id: string;
  counterparty: string;
  balance: string;
  state: 'active' | 'closing' | 'closed' | 'dispute';
  lastUpdated: string;
  expiry?: string;
  history?: ChannelHistoryItem[];
}

export interface ChannelHistoryItem {
  id: string;
  type: 'open' | 'topup' | 'payment' | 'close' | 'dispute';
  amount?: string;
  timestamp: string;
  description?: string;
}

export async function getChannels(): Promise<PaymentChannel[]> {
  const res = await fetch(`${API_BASE}/api/payment-channels`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch channels');
  return res.json();
}

export async function openChannel(depositAmount: string, counterparty: string = 'SYNCRO Executor'): Promise<PaymentChannel> {
  const res = await fetch(`${API_BASE}/api/payment-channels`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ depositAmount, counterparty }),
  });
  if (!res.ok) throw new Error('Failed to open channel');
  return res.json();
}

export async function topUpChannel(channelId: string, amount: string): Promise<PaymentChannel> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}/topup`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  if (!res.ok) throw new Error('Failed to top up channel');
  return res.json();
}

export async function closeChannel(channelId: string, unilateral: boolean = false): Promise<PaymentChannel> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}/close`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unilateral }),
  });
  if (!res.ok) throw new Error('Failed to close channel');
  return res.json();
}

export async function getChannel(channelId: string): Promise<PaymentChannel> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch channel');
  return res.json();
}
