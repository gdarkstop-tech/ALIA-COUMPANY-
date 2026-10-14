import { Tabs } from 'expo-router';
import { tabIcon, useTabScreenOptions } from '@/features/TabBar';
import { useI18n } from '@/providers/i18n';
import { activeExperience, useMe } from '@/providers/session';

export default function ClinicianTabs() {
  const { t } = useI18n();
  const options = useTabScreenOptions();
  const me = useMe();
  const isNurse = activeExperience(me.data) === 'NURSE';
  return (
    <Tabs screenOptions={options}>
      <Tabs.Screen name="index" options={{ title: t('nav.today'), tabBarIcon: tabIcon('sun'), tabBarButtonTestID: 'tab-today' }} />
      <Tabs.Screen name="services" options={{ title: t('nav.services'), tabBarIcon: tabIcon('mci:medical-bag'), href: isNurse ? undefined : null, tabBarButtonTestID: 'tab-services' }} />
      <Tabs.Screen name="availability" options={{ title: t('nav.availability'), tabBarIcon: tabIcon('calendar'), tabBarButtonTestID: 'tab-availability' }} />
      <Tabs.Screen name="earnings" options={{ title: t('nav.earnings'), tabBarIcon: tabIcon('mci:wallet-outline'), tabBarButtonTestID: 'tab-earnings' }} />
      <Tabs.Screen name="verification" options={{ title: t('nav.verification'), tabBarIcon: tabIcon('shield'), tabBarButtonTestID: 'tab-verification' }} />
      <Tabs.Screen name="me" options={{ title: t('nav.me'), tabBarIcon: tabIcon('user'), tabBarButtonTestID: 'tab-me' }} />
    </Tabs>
  );
}
