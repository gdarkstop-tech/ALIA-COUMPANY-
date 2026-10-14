import { Tabs } from 'expo-router';
import { tabIcon, useTabScreenOptions } from '@/features/TabBar';
import { useI18n } from '@/providers/i18n';

export default function PatientTabs() {
  const { t } = useI18n();
  const options = useTabScreenOptions();
  return (
    <Tabs screenOptions={options}>
      <Tabs.Screen name="index" options={{ title: t('nav.home'), tabBarIcon: tabIcon('home'), tabBarButtonTestID: 'tab-home' }} />
      <Tabs.Screen name="health" options={{ title: t('nav.health'), tabBarIcon: tabIcon('heart'), tabBarButtonTestID: 'tab-health' }} />
      <Tabs.Screen name="care" options={{ title: t('nav.care'), tabBarIcon: tabIcon('search'), tabBarButtonTestID: 'tab-care' }} />
      <Tabs.Screen name="store" options={{ title: t('nav.store'), tabBarIcon: tabIcon('shopping-bag'), tabBarButtonTestID: 'tab-store' }} />
      <Tabs.Screen name="me" options={{ title: t('nav.me'), tabBarIcon: tabIcon('user'), tabBarButtonTestID: 'tab-me' }} />
    </Tabs>
  );
}
