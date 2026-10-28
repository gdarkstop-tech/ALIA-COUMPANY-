'use client';
import { COMMERCE_BRAND } from '@ghayarly/shared';
import { brandConfig } from '@ghayarly/tokens';
import { useI18n } from './Providers';

/**
 * The official TetraSol logo (supplied file; scripts/brand/prepare-supplied-assets.py only removes
 * its white backdrop). `full` carries the tagline and is for large placements only. On dark
 * surfaces it sits on a light plate (globals.css).
 */
export function TetraSolLogo({ height = 24, variant = 'wordmark', testId }: { height?: number; variant?: 'full' | 'wordmark'; testId?: string }) {
  return (
    <span className="tetrasol-logo" data-testid={testId}>
      <img src={variant === 'full' ? '/brand/tetrasol-logo.png' : '/brand/tetrasol-wordmark.png'} alt="TetraSol" style={{ height }} />
    </span>
  );
}

/** A brand name: the official logo when one is supplied (TetraSol), otherwise the plain name. */
export function BrandName({ brand, height = 18 }: { brand: string; height?: number }) {
  return brand === COMMERCE_BRAND ? <TetraSolLogo height={height} /> : <>{brand}</>;
}

/** The orange swirl loader, with its label for screen readers and sighted users. */
export function BrandLoader({ size = 48, label }: { size?: number; label?: string }) {
  const { t } = useI18n();
  const text = label ?? t('common.loading');
  return (
    <div className="brand-loader" role="status" aria-live="polite" data-testid="brand-loader">
      <img src="/brand/loader-swirl.png" alt="" width={size} height={size} />
      <span>{text}</span>
    </div>
  );
}

/**
 * The official Dress My Wound wordmark (vector files from scripts/brand/generate-assets.ts). The
 * artwork itself is tagline-free; the console subtitle is live, localised text under it and is used
 * in this admin console only — never on patient-facing screens.
 *
 * `onInverse`: placed on the inverse surface (the sidebar: navy in light mode, pale in dark mode).
 * Otherwise it sits on the page surface. Each case picks the lettering colour per colour scheme.
 */
export function DmwWordmark({ width = 220, onInverse = false, subtitle = false, testId }: { width?: number; onInverse?: boolean; subtitle?: boolean; testId?: string }) {
  const { t } = useI18n();
  const darkLettering = '/brand/dmw-wordmark.svg'; // for light surfaces
  const lightLettering = '/brand/dmw-wordmark-inverse.svg'; // for dark surfaces
  return (
    <div className="dmw-lockup" style={{ width }} data-testid={testId}>
      <picture>
        <source srcSet={onInverse ? darkLettering : lightLettering} media="(prefers-color-scheme: dark)" />
        <img src={onInverse ? lightLettering : darkLettering} alt={`${brandConfig.product.nameEn} | ${brandConfig.product.nameAr}`} width={width} />
      </picture>
      {subtitle ? <div className="dmw-subtitle">{t('admin.consoleSubtitle')}</div> : null}
    </div>
  );
}
