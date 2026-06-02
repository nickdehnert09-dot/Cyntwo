import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { usePlayer } from "@/src/context/PlayerContext";
import { colors } from "@/src/theme";

export function MiniPlayer() {
  const router = useRouter();
  const { current, isPlaying, toggle, next, positionMs, durationMs } = usePlayer();
  if (!current) return null;

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <Pressable
      testID="mini-player"
      onPress={() => router.push("/player")}
      style={styles.container}
    >
      <View style={[styles.progress, { width: `${progress * 100}%` }]} />

      <View style={styles.row}>
        <View style={styles.artwork}>
          {current.imageUrl ? (
            <Image source={{ uri: current.imageUrl }} style={styles.artworkImg} />
          ) : (
            <Feather name="music" size={18} color={colors.textMuted} />
          )}
        </View>

        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>{current.title}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {current.artist || "Suno"}
          </Text>
        </View>

        <Pressable
          testID="mini-play-pause"
          hitSlop={8}
          onPress={async (e) => {
            e.stopPropagation();
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            toggle();
          }}
          style={styles.playBtn}
        >
          <Feather name={isPlaying ? "pause" : "play"} size={18} color="#0A0A0A" />
        </Pressable>

        <Pressable
          testID="mini-next"
          hitSlop={8}
          onPress={async (e) => {
            e.stopPropagation();
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            next();
          }}
          style={styles.iconBtn}
        >
          <Feather name="skip-forward" size={18} color={colors.text} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 70,
    left: 8,
    right: 8,
    height: 60,
    borderRadius: 14,
    backgroundColor: "rgba(28,28,28,0.95)",
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
    zIndex: 50,
  },
  progress: {
    position: "absolute",
    bottom: 0,
    left: 0,
    height: 2,
    backgroundColor: colors.accent,
  },
  row: { flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 10 },
  artwork: {
    width: 44, height: 44, borderRadius: 8, overflow: "hidden",
    backgroundColor: "#222",
    alignItems: "center", justifyContent: "center",
  },
  artworkImg: { width: 44, height: 44 },
  info: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 14, fontWeight: "700" },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  playBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center",
  },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
