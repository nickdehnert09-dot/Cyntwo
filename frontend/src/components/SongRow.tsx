import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Song } from "@/src/api/client";
import { colors } from "@/src/theme";

function fmtDuration(sec: number | null): string {
  if (!sec || !isFinite(sec)) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type Props = {
  song: Song;
  active?: boolean;
  isPlaying?: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
};

export function SongRow({ song, active, isPlaying, onPress, onToggleFavorite }: Props) {
  const tags = song.tags
    .split(/[,|]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 2);

  return (
    <Pressable
      testID={`song-row-${song.id}`}
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
        {song.image_url ? (
          <Image source={{ uri: song.image_url }} style={styles.artworkImg} />
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
        <View style={styles.metaRow}>
          {tags.length > 0 ? (
            <Text style={styles.tag} numberOfLines={1}>{tags.join(" · ")}</Text>
          ) : (
            <Text style={styles.tag} numberOfLines={1}>{song.display_name || song.handle || "Suno"}</Text>
          )}
        </View>
        <View style={styles.statsRow}>
          {song.play_count > 0 && (
            <View style={styles.statItem}>
              <Feather name="play" size={10} color={colors.textDim} />
              <Text style={styles.stat}>{fmtCount(song.play_count)}</Text>
            </View>
          )}
          {song.like_count > 0 && (
            <View style={styles.statItem}>
              <Feather name="heart" size={10} color={colors.textDim} />
              <Text style={styles.stat}>{fmtCount(song.like_count)}</Text>
            </View>
          )}
          {song.duration ? <Text style={styles.stat}>{fmtDuration(song.duration)}</Text> : null}
        </View>
      </View>

      <Pressable
        testID={`favorite-btn-${song.id}`}
        hitSlop={10}
        onPress={async (e) => {
          e.stopPropagation();
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onToggleFavorite();
        }}
        style={styles.favBtn}
      >
        <Feather
          name="heart"
          size={18}
          color={song.is_favorite ? colors.accent : colors.textDim}
        />
      </Pressable>
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
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  tag: { color: colors.textMuted, fontSize: 12 },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 1 },
  statItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  stat: { color: colors.textDim, fontSize: 11 },
  favBtn: { padding: 6 },
});
