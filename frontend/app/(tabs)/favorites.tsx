import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type Song } from "@/src/api/client";
import { usePlayer } from "@/src/context/PlayerContext";
import { SongRow } from "@/src/components/SongRow";
import { colors } from "@/src/theme";

export default function FavoritesScreen() {
  const insets = useSafeAreaInsets();
  const { current, isPlaying, playFromList } = usePlayer();
  const [songs, setSongs] = useState<Song[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const data = await api<Song[]>("/library?favorites_only=true");
      setSongs(data);
    } catch (e) {
      console.warn("favorites load failed", e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onPlay = (song: Song) => {
    const idx = songs.findIndex((s) => s.id === song.id);
    if (idx >= 0) playFromList(songs, idx);
  };

  const onToggleFav = async (song: Song) => {
    setSongs((prev) => prev.filter((s) => s.id !== song.id));
    try { await api(`/library/favorite/${song.id}`, { method: "POST" }); }
    catch { load(); }
  };

  const bottomPad = insets.bottom + 70 + (current ? 70 : 0) + 16;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>FAVORITES</Text>
        <Text style={styles.title}>Pinned tracks</Text>
        <Text style={styles.sub}>{songs.length} {songs.length === 1 ? "track" : "tracks"}</Text>
      </View>

      <FlatList
        testID="favorites-list"
        data={songs}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: bottomPad, paddingTop: 4 }}
        renderItem={({ item }) => (
          <SongRow
            song={item}
            active={current?.id === item.id}
            isPlaying={isPlaying && current?.id === item.id}
            onPress={() => onPlay(item)}
            onToggleFavorite={() => onToggleFav(item)}
          />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="heart" size={52} color={colors.textDim} />
            <Text style={styles.emptyTitle}>No favorites yet</Text>
            <Text style={styles.emptyText}>
              Tap the heart on any track in your library to pin it here.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6 },
  headerLabel: { color: colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  title: { color: colors.text, fontSize: 32, fontWeight: "800", letterSpacing: -1, marginTop: 4 },
  sub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: 32, gap: 12 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: "center", lineHeight: 20 },
});
