import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { CynSong } from "@/src/api/client";
import { colors } from "@/src/theme";

function fmtDuration(sec: number | null | undefined): string {
  if (!sec || !isFinite(sec)) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  song: CynSong;
  active?: boolean;
  isPlaying?: boolean;
  onPress: () => void;
};

export function SongRow({ song, active, isPlaying, onPress }: Props) {
  const tagPieces = (song.tags || "")
    .split(/[,|]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 2);

  return (
    <Pressable
      testID={`song-row-${song.sunoId}`}
      onPress={async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        active && styles.rowActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={styles.artwork}>
        {song.imageUrl ? (
          <Image source={{ uri: song.imageUrl }} style={styles.artworkImg} />
        ) : (
          <Feather name="music" size={20} color={colors.textMuted} />
        )}
        {active && (
          <View style={styles.playingOverlay}>
            <Feather name={isPlaying ? "volume-2" : "pause"} size={14} color={colors.accent} />
          </View>
        )}
      </View>

      <View style={styles.info}>
        <Text style={[styles.title, active && { color: colors.accent }]} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.tag} numberOfLines={1}>
          {tagPieces.length > 0 ? tagPieces.join(" · ") : (song.artist || song.genre || "Suno")}
        </Text>
        {song.duration ? (
          <Text style={styles.stat}>{fmtDuration(song.duration)}</Text>
        ) : null}
      </View>

      <Feather name="play" size={16} color={active ? colors.accent : colors.textDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "transparent",
  },
  rowActive: {
    backgroundColor: "rgba(255,140,0,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,140,0,0.2)",
  },
  artwork: {
    width: 56, height: 56, borderRadius: 8, overflow: "hidden",
    backgroundColor: "#1a1a1a",
    alignItems: "center", justifyContent: "center",
  },
  artworkImg: { width: 56, height: 56 },
  playingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  info: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: colors.text, fontSize: 15, fontWeight: "600" },
  tag: { color: colors.textMuted, fontSize: 12 },
  stat: { color: colors.textDim, fontSize: 11 },
});
