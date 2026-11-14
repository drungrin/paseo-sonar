// The Sonar panel: what the agent does now, the route it took, its turns with rows that open to
// their details, and where the work went.
import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { Icon, Loading, ScrollView } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, Text, View, type TextProps } from "react-native";
import { mix, withAlpha } from "./colors";
import type { DetailView, RouteStop, RowView, SonarView, TurnView } from "./model";
import { STATION_NAMES, STATIONS, stationSvg, type StationId } from "./stations";
import { useSonar, type SonarAgent } from "./use-sonar";

type Theme = PluginAgentPanelProps["theme"];
type Navigation = PluginAgentPanelProps["navigation"];

// ---- Type -------------------------------------------------------------------------------------

const MONO_STACK = Platform.select({
  web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  ios: "Menlo",
  default: "monospace",
});
// On the web Paseo points every text at its interface font except what is marked `data-pmono`.
const MONO_MARK = Platform.OS === "web" ? ({ dataSet: { pmono: "" } } as object) : {};

function Mono(props: TextProps) {
  return <Text {...MONO_MARK} {...props} style={[{ fontFamily: MONO_STACK }, props.style]} />;
}

// ---- Tones ------------------------------------------------------------------------------------

type Tone = "normal" | "live" | "err";

function toneColors(theme: Theme, tone: Tone) {
  const { colors } = theme;
  // Opaque fills: the lines of the route and of a turn pass under these circles, not through them.
  if (tone === "live") return { bg: mix(colors.surface0, colors.accent, 0.14), border: colors.accent, fg: colors.accent };
  if (tone === "err") return { bg: mix(colors.surface0, colors.statusDanger, 0.14), border: colors.statusDanger, fg: colors.statusDanger };
  return { bg: colors.surface1, border: colors.border, fg: withAlpha(colors.foreground, 0.8) };
}

const rowTone = (row: RowView): Tone => (row.live ? "live" : row.status === "err" ? "err" : "normal");

function StationDot({ theme, station, tone, size, iconSize, strokeWidth }: { theme: Theme; station: StationId; tone: Tone; size: number; iconSize: number; strokeWidth: number }) {
  const colors = toneColors(theme, tone);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon icon={{ svg: stationSvg(station, strokeWidth) }} size={iconSize} color={colors.fg} />
    </View>
  );
}

// ---- Motion -----------------------------------------------------------------------------------

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => alive && setReduced(value)).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

const nativeDriver = Platform.OS !== "web";

function PulseDot({ color, still }: { color: string; still: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (still) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeDriver }),
        Animated.timing(opacity, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, still]);
  return <Animated.View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, opacity }} />;
}

/** A quarter arc that turns while something runs. */
function Spinner({ color, still }: { color: string; still: boolean }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: nativeDriver }));
    loop.start();
    return () => loop.stop();
  }, [turn, still]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 1.5,
        borderColor: "transparent",
        borderTopColor: color,
        borderRightColor: color,
        transform: [{ rotate }],
      }}
    />
  );
}

/** The thin line under the headline: a light that sweeps across while the agent works. */
function Sweep({ theme, still }: { theme: Theme; still: boolean }) {
  const [width, setWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still || width === 0) return;
    progress.setValue(0);
    const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: nativeDriver }));
    loop.start();
    return () => loop.stop();
  }, [still, width, progress]);
  const segment = width * 0.5;
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ height: 2, borderRadius: 1, backgroundColor: theme.colors.border, overflow: "hidden" }}>
      {width > 0 ? (
        still ? (
          <View style={{ position: "absolute", left: width * 0.25, width: segment, height: 2, backgroundColor: theme.colors.accent }} />
        ) : (
          <Animated.View
            style={{
              position: "absolute",
              left: 0,
              width: segment,
              height: 2,
              borderRadius: 1,
              backgroundColor: theme.colors.accent,
              transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-segment, width] }) }],
            }}
          />
        )
      ) : null}
    </View>
  );
}

// ---- Top --------------------------------------------------------------------------------------

function Kicker({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <Mono numberOfLines={1} style={{ fontSize: 10, letterSpacing: 1.6, color: theme.colors.foregroundMuted }}>
      {children}
    </Mono>
  );
}

const sectionBorder = (theme: Theme) => ({ borderBottomWidth: 1, borderBottomColor: theme.colors.border });

function ContextBar({ theme, percent }: { theme: Theme; percent: number }) {
  const { colors } = theme;
  const fill = percent >= 90 ? colors.statusDanger : percent >= 70 ? colors.statusWarning : withAlpha(colors.foreground, 0.55);
  return (
    <View style={{ gap: 6 }} accessibilityLabel={`Context window ${percent}% used`}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Mono style={{ fontSize: 11, color: colors.foregroundMuted }}>context</Mono>
        <Mono style={{ fontSize: 11, color: percent >= 70 ? fill : colors.foregroundMuted }}>{percent}%</Mono>
      </View>
      <View style={{ height: 3, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" }}>
        <View style={{ width: `${percent}%`, height: 3, backgroundColor: fill }} />
      </View>
    </View>
  );
}

function NowSection({ theme, view, agent, still }: { theme: Theme; view: SonarView; agent: SonarAgent | null; still: boolean }) {
  const { headline, parallel } = view;
  const { colors } = theme;
  return (
    <View style={[{ paddingTop: 18, paddingHorizontal: 16, paddingBottom: 16, gap: 14 }, sectionBorder(theme)]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Kicker theme={theme}>{view.clock}</Kicker>
        {view.activity ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
            <PulseDot color={colors.accent} still={still} />
            <Mono numberOfLines={1} style={{ fontSize: 11, color: colors.accent }}>
              {view.activity}
            </Mono>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 4 }}>
        <Text numberOfLines={2} style={{ fontSize: 20, fontWeight: "600", lineHeight: 25, color: colors.foreground }}>
          {headline.title}
        </Text>
        {headline.sub ? (
          <Mono numberOfLines={1} style={{ fontSize: 11, color: colors.foregroundMuted }}>
            {headline.sub}
          </Mono>
        ) : null}
        {agent?.title ? (
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.foregroundMuted }}>
            {agent.title} · {agent.provider}
          </Text>
        ) : null}
      </View>
      {headline.running ? <Sweep theme={theme} still={still} /> : null}
      {parallel ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon icon={{ svg: stationSvg(parallel.station, 1.7) }} size={14} color={colors.accent} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: withAlpha(colors.foreground, 0.85) }}>
            {parallel.text}
          </Text>
          <Mono style={{ fontSize: 11, color: colors.foregroundMuted }}>{parallel.elapsed}</Mono>
        </View>
      ) : null}
      {view.context ? <ContextBar theme={theme} percent={view.context.percent} /> : null}
    </View>
  );
}

function RouteSection({ theme, route }: { theme: Theme; route: RouteStop[] }) {
  if (route.length === 0) return null;
  return (
    <View style={[{ paddingVertical: 14, paddingHorizontal: 16, gap: 10 }, sectionBorder(theme)]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Kicker theme={theme}>ROUTE · LAST {route.length}</Kicker>
        {route.length > 1 ? <Kicker theme={theme}>old → new</Kicker> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: route.length > 1 ? "space-between" : "flex-start" }}>
        {route.length > 1 ? <View style={{ position: "absolute", left: 12, right: 12, top: 12.5, height: 1, backgroundColor: theme.colors.border }} /> : null}
        {route.map((stop, index) => (
          <View key={index} accessibilityLabel={`${STATION_NAMES[stop.station]}${stop.state === "live" ? ", running" : stop.state === "err" ? ", failed" : ""}`}>
            <StationDot theme={theme} station={stop.station} tone={stop.state === "live" ? "live" : stop.state === "err" ? "err" : "normal"} size={26} iconSize={12} strokeWidth={1.9} />
          </View>
        ))}
      </View>
    </View>
  );
}

// ---- Turns ------------------------------------------------------------------------------------

/** Rows an earlier turn shows before the rest fold into "+N earlier steps". */
const EARLIER_ROWS = 4;
/** Turns drawn at all; older ones stay counted in the totals. */
const MAX_TURNS = 30;
/** Lines of output, diff or text an open row shows before "more". */
const PREVIEW_LINES = 4;

interface RowsState {
  open: string | null;
  toggle(key: string): void;
  more: ReadonlySet<string>;
  toggleMore(key: string): void;
}

function TurnBlock(props: {
  theme: Theme;
  turn: TurnView;
  newest: boolean;
  unfolded: boolean;
  unfold(): void;
  rows: RowsState;
  details(key: string): DetailView | null;
  navigation: Navigation;
  agentId: string;
  still: boolean;
}) {
  const { theme, turn, newest, unfolded, rows } = props;
  // The newest turn whole; earlier ones their first rows, and always what runs or failed, so a
  // failure the route marks is never folded away.
  let shown = turn.rows;
  if (!newest && !unfolded && turn.rows.length > EARLIER_ROWS) {
    const kept = (row: RowView) => row.pinned || row.status === "err";
    const room = Math.max(0, EARLIER_ROWS - turn.rows.filter(kept).length);
    let others = 0;
    shown = turn.rows.filter((row) => kept(row) || others++ < room);
  }
  const hidden = turn.rows.length - shown.length;
  const right = [formatTurnClock(turn.startedAt), turn.duration !== undefined && !turn.active ? formatTurnDuration(turn.duration) : ""].filter(Boolean).join(" · ");
  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: newest ? 0 : 16, paddingBottom: 8, gap: 8 }}>
        <Kicker theme={theme}>{turn.label}</Kicker>
        <Kicker theme={theme}>{right}</Kicker>
      </View>
      <View>
        <View style={{ position: "absolute", left: 11, top: 8, bottom: 8, width: 1, backgroundColor: theme.colors.border }} />
        {shown.map((row) => (
          <RowItem
            key={row.key}
            theme={theme}
            row={row}
            dim={!newest && !row.pinned}
            open={row.pinned || rows.open === row.key}
            onPress={row.pinned ? undefined : () => rows.toggle(row.key)}
            more={rows.more.has(row.key)}
            toggleMore={() => rows.toggleMore(row.key)}
            details={props.details}
            navigation={props.navigation}
            agentId={props.agentId}
            still={props.still}
          />
        ))}
        {hidden > 0 ? (
          <Pressable accessibilityRole="button" onPress={props.unfold} style={{ paddingLeft: 35, paddingVertical: 6 }}>
            <Mono style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>
              +{hidden} earlier {hidden === 1 ? "step" : "steps"}
            </Mono>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function RowItem(props: {
  theme: Theme;
  row: RowView;
  dim: boolean;
  open: boolean;
  onPress?: () => void;
  more: boolean;
  toggleMore(): void;
  details(key: string): DetailView | null;
  navigation: Navigation;
  agentId: string;
  still: boolean;
}) {
  const { theme, row, open } = props;
  const { colors } = theme;
  const tone = rowTone(row);
  const titleColor = tone === "err" ? colors.statusDanger : colors.foreground;
  const trailingColor = tone === "live" ? colors.accent : tone === "err" ? colors.statusDanger : colors.foregroundMuted;
  const card = open
    ? {
        borderWidth: 1,
        borderRadius: 10,
        padding: 10,
        marginVertical: 4,
        borderColor: tone === "live" ? colors.accent : tone === "err" ? withAlpha(colors.statusDanger, 0.6) : colors.border,
        backgroundColor: tone === "live" ? mix(colors.surface0, colors.accent, 0.06) : tone === "err" ? mix(colors.surface0, colors.statusDanger, 0.06) : colors.surface1,
      }
    : { paddingVertical: 6 };
  const header = (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <StationDot theme={theme} station={row.station} tone={tone} size={23} iconSize={11} strokeWidth={2} />
      <View style={{ flex: 1, minWidth: 0, gap: 2, paddingTop: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={open ? 2 : 1} style={{ flex: 1, fontSize: 13, color: titleColor }}>
            {row.title}
          </Text>
          {row.live ? <Spinner color={colors.accent} still={props.still} /> : null}
          {row.trailing ? <Mono style={{ fontSize: 11, color: trailingColor, flexShrink: 0 }}>{row.trailing}</Mono> : null}
          {props.onPress || row.pinned ? (
            <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={withAlpha(colors.foregroundMuted, row.pinned ? 0.5 : 1)} />
          ) : null}
        </View>
        {row.meta ? (
          <Mono numberOfLines={1} style={{ fontSize: 11, color: row.metaTone === "err" ? withAlpha(colors.statusDanger, 0.85) : colors.foregroundMuted }}>
            {row.meta}
          </Mono>
        ) : null}
      </View>
    </View>
  );
  return (
    <View style={[card, { opacity: props.dim && !open ? 0.7 : 1 }]}>
      {props.onPress ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${row.title}${row.trailing ? `, ${row.trailing}` : ""}`} onPress={props.onPress}>
          {header}
        </Pressable>
      ) : (
        header
      )}
      {open ? <RowDetails {...props} /> : null}
    </View>
  );
}

function Box({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <View style={{ borderRadius: 8, backgroundColor: withAlpha(theme.colors.surface0, 0.9), borderWidth: 1, borderColor: theme.colors.border, paddingVertical: 8, paddingHorizontal: 10, gap: 2 }}>{children}</View>;
}

function Link({ theme, label, onPress }: { theme: Theme; label: string; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6}>
      <Mono style={{ fontSize: 11, color: theme.colors.accent }}>{label}</Mono>
    </Pressable>
  );
}

function lastLines(text: string, count: number): { lines: string[]; total: number } {
  const lines = text.split("\n");
  return { lines: lines.slice(-count), total: lines.length };
}

function RowDetails(props: {
  theme: Theme;
  row: RowView;
  more: boolean;
  toggleMore(): void;
  details(key: string): DetailView | null;
  navigation: Navigation;
  agentId: string;
}) {
  const { theme, row, more } = props;
  const { colors } = theme;
  const detail = props.details(row.key);
  if (!detail) return null;
  const links: ReactNode[] = [];
  const openAgent = props.navigation?.openAgent;
  if (openAgent) links.push(<Link key="chat" theme={theme} label="Go to chat →" onPress={() => openAgent({ agentId: props.agentId })} />);
  const body: ReactNode[] = [];
  const mono = { fontSize: 11, lineHeight: 16 };
  const muted = colors.foregroundMuted;

  if (detail.kind === "shell") {
    body.push(
      <Mono key="cmd" selectable style={{ ...mono, color: withAlpha(colors.foreground, 0.9) }}>
        {detail.command}
      </Mono>,
    );
    if (detail.cwd) body.push(<Mono key="cwd" style={{ ...mono, color: muted }}>cwd {detail.cwd}</Mono>);
    if (detail.note) body.push(<Mono key="note" style={{ ...mono, color: detail.failed ? colors.statusDanger : muted }}>{detail.note}</Mono>);
    if (detail.output) {
      const { lines, total } = more ? { lines: detail.output.split("\n").slice(-400), total: detail.output.split("\n").length } : lastLines(detail.output, PREVIEW_LINES);
      body.push(
        <Box key="out" theme={theme}>
          {lines.map((line, index) => (
            <Mono key={index} selectable style={{ ...mono, color: detail.failed ? colors.statusDanger : withAlpha(colors.foreground, 0.8) }}>
              {line || " "}
            </Mono>
          ))}
        </Box>,
      );
      if (total > PREVIEW_LINES) links.push(<Link key="more" theme={theme} label={more ? "show less" : `full output (${total} lines)`} onPress={props.toggleMore} />);
    }
  } else if (detail.kind === "diff") {
    const lines = more ? detail.lines.slice(0, 400) : detail.lines.slice(0, PREVIEW_LINES);
    if (lines.length > 0) {
      body.push(
        <Box key="diff" theme={theme}>
          {lines.map((line, index) => (
            <Mono
              key={index}
              numberOfLines={more ? undefined : 1}
              style={{ ...mono, color: line.sign === "+" ? colors.statusSuccess : line.sign === "-" ? colors.statusDanger : muted }}
            >
              {line.sign === "@" ? line.text : `${line.sign} ${line.text}`}
            </Mono>
          ))}
        </Box>,
      );
    }
    const rest = detail.lines.length - PREVIEW_LINES;
    if (rest > 0) links.push(<Link key="more" theme={theme} label={more ? "show less" : `+ ${rest} lines`} onPress={props.toggleMore} />);
  } else if (detail.kind === "agent") {
    if (detail.task) body.push(<Text key="task" style={{ fontSize: 13, lineHeight: 18, color: withAlpha(colors.foreground, 0.9) }}>{detail.task}</Text>);
    if (detail.steps.length > 0) {
      body.push(
        <Box key="steps" theme={theme}>
          {detail.steps.map((step, index) => (
            <View key={index} style={{ flexDirection: "row", gap: 8 }}>
              <Mono numberOfLines={1} style={{ ...mono, flex: 1, color: step.tone === "err" ? colors.statusDanger : index === detail.steps.length - 1 && row.live ? colors.accent : withAlpha(colors.foreground, 0.85) }}>
                {step.text}
              </Mono>
              {step.when ? <Mono style={{ ...mono, color: muted }}>{step.when}</Mono> : null}
            </View>
          ))}
        </Box>,
      );
    } else {
      body.push(
        <Mono key="wait" style={{ ...mono, color: muted }}>
          {row.live ? "Its steps show here from its next one on." : "No steps reported while Sonar was watching."}
        </Mono>,
      );
    }
    if (detail.log) body.push(<Mono key="log" numberOfLines={more ? undefined : 3} style={{ ...mono, color: muted }}>{detail.log}</Mono>);
  } else if (detail.kind === "text") {
    if (detail.text) {
      const lines = detail.text.split("\n");
      body.push(
        <Text key="text" selectable numberOfLines={more ? undefined : 8} style={{ fontSize: 12, lineHeight: 18, color: withAlpha(colors.foreground, 0.85) }}>
          {detail.text}
        </Text>,
      );
      if (lines.length > 8 || detail.text.length > 600) links.push(<Link key="more" theme={theme} label={more ? "show less" : "show all"} onPress={props.toggleMore} />);
    }
  } else {
    for (const field of detail.fields) {
      body.push(
        <View key={field.label} style={{ flexDirection: "row", gap: 8 }}>
          <Mono style={{ ...mono, color: muted, width: 44 }}>{field.label}</Mono>
          <Mono selectable numberOfLines={more ? undefined : 4} style={{ ...mono, flex: 1, color: withAlpha(colors.foreground, 0.85) }}>
            {field.value}
          </Mono>
        </View>,
      );
    }
    if (detail.output) {
      const { lines, total } = more ? { lines: detail.output.split("\n").slice(0, 400), total: detail.output.split("\n").length } : { lines: detail.output.split("\n").slice(0, PREVIEW_LINES), total: detail.output.split("\n").length };
      body.push(
        <Box key="out" theme={theme}>
          {lines.map((line, index) => (
            <Mono key={index} selectable numberOfLines={more ? undefined : 1} style={{ ...mono, color: row.status === "err" ? colors.statusDanger : withAlpha(colors.foreground, 0.8) }}>
              {line || " "}
            </Mono>
          ))}
        </Box>,
      );
      if (total > PREVIEW_LINES) links.push(<Link key="more" theme={theme} label={more ? "show less" : `full output (${total} lines)`} onPress={props.toggleMore} />);
    }
  }

  return (
    <View style={{ gap: 8, paddingTop: 8, paddingLeft: 35 }}>
      {body}
      {links.length > 0 ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, paddingTop: 2 }}>{links}</View> : null}
    </View>
  );
}

function formatTurnClock(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatTurnDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// ---- Counts -----------------------------------------------------------------------------------

function Legend({ theme, view }: { theme: Theme; view: SonarView }) {
  const { colors } = theme;
  const tiles: { key: string; name: string; svg: string; value: string; label: string; tone: Tone; dim: boolean }[] = STATIONS.map((station) => {
    const count = view.counts[station];
    const tone: Tone = view.liveStations.has(station) ? "live" : view.errorStations.has(station) ? "err" : "normal";
    return { key: station, name: STATION_NAMES[station], svg: stationSvg(station), value: String(count), label: `${STATION_NAMES[station]}: ${count}`, tone, dim: count === 0 };
  });
  tiles.push({ key: "hooks", name: "Hooks", svg: stationSvg("hooks"), value: "–", label: "Hooks: Paseo 0.15 does not report them", tone: "normal", dim: true });
  return (
    <View style={{ paddingTop: 12, paddingBottom: 12, paddingHorizontal: 9, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 }}>
      <View style={{ paddingHorizontal: 7 }}>
        <Kicker theme={theme}>{view.scope} · STEPS</Kicker>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {tiles.map((tile) => {
          const fg = tile.tone === "live" ? colors.accent : tile.tone === "err" ? colors.statusDanger : withAlpha(colors.foreground, 0.8);
          return (
            <View key={tile.key} style={{ width: "20%", padding: 3 }}>
              <View
                accessibilityLabel={tile.label}
                style={{ alignItems: "center", gap: 4, paddingVertical: 8, borderRadius: 8, backgroundColor: tile.tone === "live" ? withAlpha(colors.accent, 0.1) : "transparent", opacity: tile.dim ? 0.45 : 1 }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Icon icon={{ svg: tile.svg }} size={12} color={fg} />
                  <Mono style={{ fontSize: 11, fontWeight: "600", color: fg }}>{tile.value}</Mono>
                </View>
                <Text numberOfLines={1} style={{ fontSize: 10, color: colors.foregroundMuted }}>
                  {tile.name}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ---- Panel ------------------------------------------------------------------------------------

export function SonarPanel({ theme, params, tab, navigation }: PluginAgentPanelProps) {
  const state = useSonar(params.agentId, tab);
  const still = useReducedMotion();
  const { colors } = theme;
  const [open, setOpen] = useState<string | null>(null);
  const [more, setMore] = useState<ReadonlySet<string>>(() => new Set());
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((key: string) => setOpen((current) => (current === key ? null : key)), []);
  const toggleMore = useCallback(
    (key: string) =>
      setMore((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );
  const rows = useMemo<RowsState>(() => ({ open, toggle, more, toggleMore }), [open, toggle, more, toggleMore]);
  const turns = useMemo(() => (state.phase === "ready" ? state.view.turns.slice(0, MAX_TURNS) : []), [state]);

  if (state.phase === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface0, alignItems: "center", justifyContent: "center" }}>
        <Loading />
      </View>
    );
  }
  if (state.phase === "error") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface0, padding: 16, gap: 12, justifyContent: "center" }}>
        <Text style={{ color: colors.statusDanger, fontSize: 13 }}>Sonar could not read this agent's timeline: {state.message}</Text>
        <Pressable accessibilityRole="button" onPress={state.retry} style={{ alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.surface2 }}>
          <Text style={{ color: colors.foreground, fontSize: 13 }}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const { view, agent, details } = state;
  return (
    <View testID="sonar-panel" style={{ flex: 1, backgroundColor: colors.surface0 }}>
      <NowSection theme={theme} view={view} agent={agent} still={still} />
      <RouteSection theme={theme} route={view.route} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 16, paddingBottom: 14 }}>
        {view.empty ? (
          <Text style={{ fontSize: 13, color: colors.foregroundMuted }}>Sonar draws this agent's steps here as they happen.</Text>
        ) : (
          turns.map((turn, index) => (
            <TurnBlock
              key={turn.key}
              theme={theme}
              turn={turn}
              newest={index === 0}
              unfolded={unfolded.has(turn.key)}
              unfold={() => setUnfolded((current) => new Set(current).add(turn.key))}
              rows={rows}
              details={details}
              navigation={navigation}
              agentId={params.agentId}
              still={still}
            />
          ))
        )}
      </ScrollView>
      <Legend theme={theme} view={view} />
    </View>
  );
}
