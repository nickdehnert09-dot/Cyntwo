import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
import {
  Dimensions,
  GestureResponderEvent,
  Image,
  LayoutChangeEvent,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { usePlayer } from "@/src/context/PlayerContext";
import { colors } from "@/src/theme";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

function fmt(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

const { width } = Dimensions.get("window");

export default function PlayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    current,
    isPlaying,
    positionMs,
    durationMs,
    shuffle,
    repeat,
    toggle,
    next,
    prev,
    seekTo,
    setShuffle,
    cycleRepeat,
  } = usePlayer();

  const [seekWidth, setSeekWidth] = useState(0);
  const [favPending, setFavPending] = useState(false);
  const [localFav, setLocalFav] = useState<boolean | null>(null);
  const [sharePending, setSharePending] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);

  const onSeekLayout = (e: LayoutChangeEvent) => setSeekWidth(e.nativeEvent.layout.width);
  const onSeekPress = (e: GestureResponderEvent) => {
    if (!durationMs || !seekWidth) return;
    const x = e.nativeEvent.locationX;
    const ratio = Math.max(0, Math.min(1, x / seekWidth));
    seekTo(ratio * durationMs);
  };

  const toggleFav = useCallback(async () => {
    if (!current || favPending) return;
    setFavPending(true);
    const cur = (localFav ?? current.is_favorite) ? false : true;
    setLocalFav(cur);
    try {
      await api(`/library/favorite/${current.id}`, { method: "POST" });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      setLocalFav(!cur);
    } finally {
      setFavPending(false);
    }
  }, [current, favPending, localFav]);

  if (!current) {
    return (
      <View style={[styles.empty, { paddingTop: insets.top + 24 }]}>
        <Pressable testID="player-close-empty" onPress={() => router.back()} hitSlop={12}>
          <Feather name="chevron-down" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.emptyText}>No track playing</Text>
      </View>
    );
  }

  const progress = durationMs > 0 ? positionMs / durationMs : 0;
  const isFav = localFav ?? current.is_favorite;
  const repeatIcon = repeat === "one" ? "repeat" : repeat === "all" ? "repeat" : "repeat";

  return (
    <View style={styles.root}>
      {current.image_url ? (
        <Image source={{ uri: current.image_url }} style={StyleSheet.absoluteFill} blurRadius={40} />
      ) : null}
      <LinearGradient
        colors={["rgba(10,10,10,0.6)", "rgba(10,10,10,0.9)", colors.bg]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="player-close" onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
          <Feather name="chevron-down" size={26} color={colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerLabel}>NOW PLAYING</Text>
          <Text style={styles.headerHandle} numberOfLines={1}>
            {current.display_name || current.handle || "Suno"}
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.artworkWrap}>
        <View style={styles.artwork}>
          {current.image_url ? (
            <Image source={{ uri: current.image_url }} style={styles.artworkImg} />
          ) : (
            <Feather name="music" size={72} color={colors.textMuted} />
          )}
        </View>
      </View>

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>{current.title}</Text>
        {current.tags ? (
          <Text style={styles.tags} numberOfLines={1}>{current.tags}</Text>
        ) : null}
      </View>

      <Pressable testID="seek-bar" onPress={onSeekPress} style={styles.seekHit} onLayout={onSeekLayout}>
        <View style={styles.seekTrack}>
          <View style={[styles.seekFill, { width: `${progress * 100}%` }]} />
          <View style={[styles.seekThumb, { left: `${progress * 100}%` }]} />
        </View>
      </Pressable>

      <View style={styles.timeRow}>
        <Text style={styles.time}>{fmt(positionMs)}</Text>
        <Text style={styles.time}>{fmt(durationMs)}</Text>
      </View>

      <View style={styles.controlsRow}>
        <Pressable
          testID="shuffle-btn"
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShuffle(!shuffle); }}
          hitSlop={8}
          style={styles.smallBtn}
        >
          <Feather name="shuffle" size={20} color={shuffle ? colors.accent : colors.textMuted} />
        </Pressable>

        <Pressable
          testID="prev-btn"
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); prev(); }}
          hitSlop={8}
          style={styles.smallBtn}
        >
          <Feather name="skip-back" size={28} color={colors.text} />
        </Pressable>

        <Pressable
          testID="play-pause-btn"
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); toggle(); }}
          style={({ pressed }) => [styles.playBtn, { transform: [{ scale: pressed ? 0.95 : 1 }] }]}
        >
          <Feather name={isPlaying ? "pause" : "play"} size={32} color="#0A0A0A" />
        </Pressable>

        <Pressable
          testID="next-btn"
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); next(); }}
          hitSlop={8}
          style={styles.smallBtn}
        >
          <Feather name="skip-forward" size={28} color={colors.text} />
        </Pressable>

        <Pressable
          testID="repeat-btn"
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); cycleRepeat(); }}
          hitSlop={8}
          style={styles.smallBtn}
        >
          <Feather name={repeatIcon} size={20} color={repeat !== "off" ? colors.accent : colors.textMuted} />
          {repeat === "one" ? <View style={styles.oneDot} /> : null}
        </Pressable>
      </View>

      <View style={styles.bottomRow}>
        <Pressable testID="fav-btn" onPress={toggleFav} hitSlop={8} style={styles.bottomBtn}>
          <Feather name="heart" size={18} color={isFav ? colors.accent : colors.textMuted} />
          <Text style={[styles.bottomLabel, isFav && { color: colors.accent }]}>
            {isFav ? "Favorited" : "Favorite"}
          </Text>
        </Pressable>

        <Pressable
          testID="share-btn"
          onPress={onShare}
          hitSlop={8}
          disabled={sharePending}
          style={[styles.bottomBtn, sharePending && { opacity: 0.6 }]}
        >
          <Feather name="share-2" size={18} color={colors.textMuted} />
          <Text style={styles.bottomLabel}>{sharePending ? "Creating…" : "Share"}</Text>
        </Pressable>
      </View>

      {shareToast ? (
        <View style={styles.toast} testID="share-toast">
          <Feather name="check-circle" size={14} color={colors.accent} />
          <Text style={styles.toastText}>{shareToast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const ART_SIZE = Math.min(width - 64, 340);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18 },
  emptyText: { color: colors.textMuted },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerLabel: { color: colors.accent, fontSize: 10, fontWeight: "700", letterSpacing: 2 },
  headerHandle: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 2 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  artworkWrap: { alignItems: "center", marginTop: 18 },
  artwork: {
    width: ART_SIZE,
    height: ART_SIZE,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#181818",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
    elevation: 18,
  },
  artworkImg: { width: ART_SIZE, height: ART_SIZE },
  info: { paddingHorizontal: 28, marginTop: 28, gap: 8 },
  title: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  tags: { color: colors.textMuted, fontSize: 13 },
  seekHit: { paddingVertical: 14, marginHorizontal: 28, marginTop: 18 },
  seekTrack: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)" },
  seekFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  seekThumb: {
    position: "absolute",
    top: -5,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  timeRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 28, marginTop: -4 },
  time: { color: colors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 28,
    marginTop: 22,
  },
  smallBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  oneDot: {
    position: "absolute",
    bottom: 12,
    right: 12,
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: colors.accent,
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOpacity: 0.55,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  bottomRow: {
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: 28,
    marginTop: 28,
    gap: 12,
  },
  bottomBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: colors.border },
  bottomLabel: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  toast: {
    position: "absolute",
    bottom: 36,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: "rgba(20,20,20,0.95)",
    borderWidth: 1,
    borderColor: "rgba(255,140,0,0.4)",
  },
  toastText: { color: colors.text, fontSize: 13, fontWeight: "600" },
});
