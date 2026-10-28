import {
  WOUND_CONSENT_TEXT,
  WOUND_PRESENTATION_AUDIENCES,
  WOUND_PRESENTATION_ORGANIZATIONS,
  WOUND_RESEARCH_PURPOSES,
  WOUND_RESEARCH_RECIPIENTS,
  type WoundConsentPurpose,
  type WoundConsentState,
  type WoundPermissions,
} from '@ghayarly/shared';
import { spacing } from '@ghayarly/tokens';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { confirmDestructive } from '@/lib/confirm';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/providers/i18n';
import { Badge, Button, Card, Checkbox, Notice, PressableScale, Text } from '@/ui';
import { useInvalidateWounds, woundErrorKey } from './hooks';

const LETTER: Record<WoundConsentPurpose, string> = { SCAN: 'A', RESEARCH: 'B', PRESENTATION: 'C' };

/** The wording of one permission, in the person's language (versioned with the server). */
export function ConsentText({ purpose, expanded }: { purpose: WoundConsentPurpose; expanded: boolean }) {
  const { locale } = useI18n();
  const copy = WOUND_CONSENT_TEXT[purpose][locale];
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="footnote" color="textSecondary">{copy.summary}</Text>
      {expanded ? copy.points.map((p, i) => <Text key={i} variant="footnote" color="textSecondary">{`• ${p}`}</Text>) : null}
    </View>
  );
}

function toggle<T extends string>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** One of A / B / C: status, wording, scope choices (B, C) and allow / withdraw. Never preselected. */
export function PermissionCard({ patientId, perms, state }: { patientId: string; perms: WoundPermissions; state: WoundConsentState }) {
  const { t, locale } = useI18n();
  const invalidate = useInvalidateWounds();
  const [expanded, setExpanded] = useState(!state.active);
  const [a, setA] = useState<string[]>([]);
  const [b, setB] = useState<string[]>([]);
  useEffect(() => {
    // The current scope when it is on; nothing ticked when it is off (no preselection).
    setA((state.purpose === 'RESEARCH' ? state.scope?.purposes : state.scope?.audiences) ?? []);
    setB((state.purpose === 'RESEARCH' ? state.scope?.recipients : state.scope?.organizations) ?? []);
  }, [state]);
  const decide = useMutation({
    mutationFn: (action: 'GRANT' | 'WITHDRAW') =>
      api.wounds.decide(patientId, {
        purpose: state.purpose,
        action,
        version: state.currentVersion,
        ...(action === 'GRANT' && state.purpose === 'RESEARCH' ? { scope: { purposes: a, recipients: b } } : {}),
        ...(action === 'GRANT' && state.purpose === 'PRESENTATION' ? { scope: { audiences: a, organizations: b } } : {}),
      }),
    onSuccess: () => invalidate(),
  });
  const copy = WOUND_CONSENT_TEXT[state.purpose][locale];
  const scoped = state.purpose !== 'SCAN';
  const listA = state.purpose === 'RESEARCH' ? WOUND_RESEARCH_PURPOSES : WOUND_PRESENTATION_AUDIENCES;
  const listB = state.purpose === 'RESEARCH' ? WOUND_RESEARCH_RECIPIENTS : WOUND_PRESENTATION_ORGANIZATIONS;
  const labelA = (v: string) => (state.purpose === 'RESEARCH' ? t(`wounds.purpose_${v as (typeof WOUND_RESEARCH_PURPOSES)[number]}`) : t(`wounds.audience_${v as (typeof WOUND_PRESENTATION_AUDIENCES)[number]}`));
  const labelB = (v: string) => (state.purpose === 'RESEARCH' ? t(`wounds.recipient_${v as (typeof WOUND_RESEARCH_RECIPIENTS)[number]}`) : t(`wounds.org_${v as (typeof WOUND_PRESENTATION_ORGANIZATIONS)[number]}`));
  const needsA = state.purpose !== 'SCAN' && !perms.consents.find((c) => c.purpose === 'SCAN')?.active;
  const blocked = state.decision !== 'ALLOWED';
  const changed = scoped && state.active && (JSON.stringify([...a].sort()) !== JSON.stringify([...(state.scope?.purposes ?? state.scope?.audiences ?? [])].sort()) || JSON.stringify([...b].sort()) !== JSON.stringify([...(state.scope?.recipients ?? state.scope?.organizations ?? [])].sort()));

  return (
    <Card style={{ gap: spacing.md }} testID={`wound-permission-${state.purpose}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text variant="callout" weight="semibold" style={{ flex: 1 }}>{copy.title}</Text>
        <Badge testID={`wound-permission-${state.purpose}-status`} label={state.active ? t('wounds.on') : t('wounds.off')} tone={state.active ? 'success' : 'neutral'} />
      </View>
      {state.active && state.since ? <Text variant="caption" color="textTertiary">{t('wounds.since', { date: formatDate(state.since, locale) })}</Text> : null}
      <ConsentText purpose={state.purpose} expanded={expanded} />
      <PressableScale accessibilityRole="button" accessibilityLabel={t('wounds.details')} onPress={() => setExpanded((v) => !v)}>
        <Text variant="footnote" color="primary" weight="semibold">{t('wounds.details')}</Text>
      </PressableScale>
      {!WOUND_CONSENT_TEXT[state.purpose].required ? <Text variant="caption" color="textTertiary">{t('wounds.optionalNote')}</Text> : null}
      {blocked ? (
        <Notice tone="info" body={state.decision === 'NOT_FOR_MINORS' ? t('wounds.decision_NOT_FOR_MINORS') : state.purpose === 'SCAN' ? t('wounds.decision_NOT_ALLOWED_SCAN') : t('wounds.decision_NOT_ALLOWED')} />
      ) : (
        <>
          {scoped && !needsA ? (
            <View style={{ gap: spacing.sm }}>
              <Text variant="footnote" weight="semibold" color="textSecondary">{state.purpose === 'RESEARCH' ? t('wounds.researchPurposes') : t('wounds.presentationAudiences')}</Text>
              {listA.map((v) => <Checkbox key={v} testID={`wound-scope-${v}`} checked={a.includes(v)} onChange={() => setA((x) => toggle(x, v))} label={labelA(v)} />)}
              <Text variant="footnote" weight="semibold" color="textSecondary">{state.purpose === 'RESEARCH' ? t('wounds.researchRecipients') : t('wounds.presentationOrganizations')}</Text>
              {listB.map((v) => <Checkbox key={v} testID={`wound-scope-${v}-${state.purpose}`} checked={b.includes(v)} onChange={() => setB((x) => toggle(x, v))} label={labelB(v)} />)}
              {(!a.length || !b.length) && (!state.active || changed) ? <Text variant="caption" color="textTertiary">{t('wounds.pickAtLeastOne')}</Text> : null}
            </View>
          ) : null}
          {needsA && !state.active ? <Notice tone="info" body={t('wounds.error_WOUND_SCAN_CONSENT_REQUIRED')} /> : null}
          {decide.error ? <Notice tone="danger" body={t(woundErrorKey(decide.error))} /> : null}
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {!state.active || changed ? (
              <Button
                testID={`wound-permission-${state.purpose}-allow`}
                label={state.active ? t('wounds.saveChoices') : t('wounds.allow')}
                size="sm"
                fullWidth={false}
                icon="check"
                loading={decide.isPending && decide.variables === 'GRANT'}
                disabled={needsA || (scoped && (!a.length || !b.length))}
                onPress={() => decide.mutate('GRANT')}
              />
            ) : null}
            {state.active ? (
              <Button
                testID={`wound-permission-${state.purpose}-withdraw`}
                label={t('wounds.withdraw')}
                variant="ghost"
                size="sm"
                fullWidth={false}
                icon="x-circle"
                loading={decide.isPending && decide.variables === 'WITHDRAW'}
                onPress={() => confirmDestructive(t(`wounds.withdrawConfirm_${state.purpose}`), { cancel: t('common.cancel'), confirm: t('wounds.withdraw') }, () => decide.mutate('WITHDRAW'))}
              />
            ) : null}
          </View>
        </>
      )}
      {perms.wordingStatus === 'DRAFT_PENDING_LEGAL_REVIEW' ? <Text variant="caption" color="textTertiary">{`${LETTER[state.purpose]} · ${t('wounds.draftWording', { version: state.currentVersion })}`}</Text> : null}
    </Card>
  );
}
