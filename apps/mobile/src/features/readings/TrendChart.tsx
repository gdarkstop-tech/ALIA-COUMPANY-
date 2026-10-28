import type { HealthSeries, SeriesPoint } from "@ghayarly/shared";
import { spacing } from "@ghayarly/tokens";
import { useState } from "react";
import { Pressable, View, type GestureResponderEvent } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { formatDate, ltr } from "@/lib/format";
import { useI18n } from "@/providers/i18n";
import { useTheme } from "@/providers/theme";
import { Text } from "@/ui";

const HEIGHT = 140;
const PAD = { top: 10, bottom: 10, start: 40, end: 14 };

/** "142/91" for blood pressure, the value otherwise. */
export const pointValue = (p: SeriesPoint) =>
  p.value2 === null ? `${p.value}` : `${p.value}/${p.value2}`;

/**
 * A recessive line chart of one series (two lines for blood pressure): 2 px lines, ringed markers,
 * hairline grid, the printed lab range as a soft band. Time runs right-to-left in Arabic. Tapping
 * selects the nearest reading (the touch equivalent of a tooltip); the table view carries every value.
 */
export function TrendChart({
  series,
  testID,
}: {
  series: HealthSeries;
  testID?: string;
}) {
  const { colors } = useTheme();
  const { t, locale, isRTL } = useI18n();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const pts = [...series.points].sort((a, b) => a.at.localeCompare(b.at));
  const times = pts.map((p) => Date.parse(p.at));
  const range = series.printedRange;
  const values = [
    ...pts.flatMap((p) =>
      p.value2 === null ? [p.value] : [p.value, p.value2],
    ),
    ...(range
      ? [range.low, range.high].filter((x): x is number => x !== null)
      : []),
  ];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
  lo -= pad;
  hi += pad;
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const plotW = Math.max(1, width - PAD.start - PAD.end);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const xOf = (ms: number) => {
    const f = t1 === t0 ? 0.5 : (ms - t0) / (t1 - t0);
    return isRTL ? PAD.end + (1 - f) * plotW : PAD.start + f * plotW;
  };
  const yOf = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;
  const path = (get: (p: SeriesPoint) => number | null) =>
    pts
      .map((p, i) => [xOf(times[i]!), get(p)] as const)
      .filter(([, v]) => v !== null)
      .map(
        ([x, v], i) => `${i ? "L" : "M"}${x.toFixed(1)},${yOf(v!).toFixed(1)}`,
      )
      .join(" ");
  const two = pts.some((p) => p.value2 !== null);
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad].map((v) =>
    Number(v.toFixed(v < 10 ? 1 : 0)),
  );
  const choose = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.locationX;
    let best = 0;
    pts.forEach((_, i) => {
      if (Math.abs(xOf(times[i]!) - x) < Math.abs(xOf(times[best]!) - x))
        best = i;
    });
    setSelected(best);
  };
  const sel = selected !== null ? pts[selected] : null;
  const latest = pts[pts.length - 1]!;
  const label = t("readings.chartLabel", {
    label: series.kind ? t(`readings.kind_${series.kind}`) : series.label,
    count: pts.length,
    from: formatDate(pts[0]!.at, locale),
    to: formatDate(latest.at, locale),
    latest: pointValue(latest),
    unit: series.unit,
  });

  return (
    <View style={{ gap: spacing.xs }} testID={testID}>
      {two ? (
        <View
          style={{ flexDirection: "row", gap: spacing.md }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {[
            [colors.chart1, t("readings.seriesSystolic")],
            [colors.chart2, t("readings.seriesDiastolic")],
          ].map(([c, name]) => (
            <View
              key={name}
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <View
                style={{
                  width: 14,
                  height: 2,
                  borderRadius: 1,
                  backgroundColor: c,
                }}
              />
              <Text variant="caption" color="textSecondary">
                {name}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <Pressable
        testID={testID ? `${testID}-plot` : undefined}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={choose}
        accessibilityRole="image"
        accessibilityLabel={label}
        style={{ height: HEIGHT }}
      >
        {width > 0 ? (
          // The wrapper speaks the summary; the drawing itself is hidden from assistive technology.
          <View
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            <Svg width={width} height={HEIGHT}>
              {range && (range.low !== null || range.high !== null) ? (
                <Rect
                  x={isRTL ? PAD.end : PAD.start}
                  width={plotW}
                  y={yOf(range.high ?? hi)}
                  height={Math.max(
                    0,
                    yOf(range.low ?? lo) - yOf(range.high ?? hi),
                  )}
                  fill={colors.textTertiary}
                  opacity={0.1}
                />
              ) : null}
              {ticks.map((v) => (
                <Line
                  key={v}
                  x1={isRTL ? PAD.end : PAD.start}
                  x2={isRTL ? PAD.end + plotW : PAD.start + plotW}
                  y1={yOf(v)}
                  y2={yOf(v)}
                  stroke={colors.divider}
                  strokeWidth={1}
                />
              ))}
              {sel ? (
                <Line
                  x1={xOf(Date.parse(sel.at))}
                  x2={xOf(Date.parse(sel.at))}
                  y1={PAD.top}
                  y2={HEIGHT - PAD.bottom}
                  stroke={colors.borderStrong}
                  strokeWidth={1}
                />
              ) : null}
              <Path
                d={path((p) => p.value)}
                stroke={colors.chart1}
                strokeWidth={2}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {two ? (
                <Path
                  d={path((p) => p.value2)}
                  stroke={colors.chart2}
                  strokeWidth={2}
                  fill="none"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}
              {pts.map((p, i) => (
                <Circle
                  key={`a${p.id}`}
                  cx={xOf(times[i]!)}
                  cy={yOf(p.value)}
                  r={i === selected ? 6 : 4}
                  fill={colors.chart1}
                  stroke={colors.surface}
                  strokeWidth={2}
                />
              ))}
              {two
                ? pts.map((p, i) =>
                    p.value2 === null ? null : (
                      <Circle
                        key={`b${p.id}`}
                        cx={xOf(times[i]!)}
                        cy={yOf(p.value2)}
                        r={i === selected ? 6 : 4}
                        fill={colors.chart2}
                        stroke={colors.surface}
                        strokeWidth={2}
                      />
                    ),
                  )
                : null}
            </Svg>
          </View>
        ) : null}
        {/* Axis labels are text (tokens), never coloured like the data. */}
        {ticks.map((v) => (
          <Text
            key={`t${v}`}
            variant="caption"
            color="textTertiary"
            tabular
            importantForAccessibility="no"
            style={{
              position: "absolute",
              top: yOf(v) - 8,
              [isRTL ? "right" : "left"]: 0,
              width: PAD.start - 6,
              textAlign: isRTL ? "left" : "right",
            }}
          >
            {ltr(String(v))}
          </Text>
        ))}
      </Pressable>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          paddingStart: PAD.start,
        }}
      >
        <Text variant="caption" color="textTertiary">
          {formatDate(pts[0]!.at, locale)}
        </Text>
        <Text variant="caption" color="textTertiary">
          {formatDate(latest.at, locale)}
        </Text>
      </View>
      {sel ? (
        <Text
          variant="footnote"
          weight="semibold"
          testID={`${testID}-selected`}
          accessibilityLiveRegion="polite"
        >
          {t("readings.selected", {
            value: ltr(pointValue(sel)),
            unit: series.unit,
            date: formatDate(sel.at, locale),
          })}
        </Text>
      ) : null}
    </View>
  );
}
