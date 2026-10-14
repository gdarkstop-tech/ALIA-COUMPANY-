import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useCart() {
  return useQuery({ queryKey: ['cart'], queryFn: () => api.store.cart() });
}

export function stockTone(s: import('@ghayarly/shared').StockStatus): import('@/ui').Tone {
  return s === 'IN_STOCK' ? 'success' : s === 'LOW_STOCK' ? 'warning' : s === 'OUT_OF_STOCK' ? 'danger' : 'neutral';
}
