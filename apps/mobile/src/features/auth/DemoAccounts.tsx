import { spacing } from '@ghayarly/tokens';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { useI18n } from '@/providers/i18n';
import { Chip, Notice } from '@/ui';

export const DEMO_PASSWORD = 'DressMyWound-Demo-2026';
const ACCOUNTS = [
  { key: 'patient', email: 'patient.demo@demo.ghayarly.test', icon: 'heart' },
  { key: 'doctor', email: 'doctor.demo@demo.ghayarly.test', icon: 'mci:stethoscope' },
  { key: 'nurse', email: 'nurse.demo@demo.ghayarly.test', icon: 'mci:needle' },
] as const;

/** Development showcase shortcuts — rendered only when the API reports demo mode. */
export function DemoAccounts({ onPick }: { onPick: (email: string, password: string) => void }) {
  const { t } = useI18n();
  const status = useQuery({ queryKey: ['system-status'], queryFn: () => api.system.status(), staleTime: 60_000 });
  if (!status.data?.demoMode) return null;
  return (
    <Notice tone="demo" title={t('auth.demoAccounts')} body={t('auth.demoAccountsHint')}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
        {ACCOUNTS.map((a) => (
          <Chip key={a.key} testID={`demo-${a.key}`} label={t(`roles.${a.key.toUpperCase() as 'PATIENT' | 'DOCTOR' | 'NURSE'}`)} icon={a.icon} onPress={() => onPick(a.email, DEMO_PASSWORD)} />
        ))}
      </View>
    </Notice>
  );
}
