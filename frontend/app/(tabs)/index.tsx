import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type Song } from "@/src/api/client";
import { usePlayer } from "@/src/context/PlayerContext";
import { SongRow } from "@/src/components/SongRow";
import { colors } from "@/src/theme";

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { current, isPlaying, playFromList } = usePlayer();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await api<Song[]>("/library");
      setSongs(data);
    } catch (e) {
      console.warn("library load failed", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onPlay = (song: Song) => {
    const filtered = filteredSongs;
    const idx = filtered.findIndex((s) => s.id === song.id);
    if (idx >= 0) playFromList(filtered, idx);
  };

  const onToggleFav = async (song: Song) => {
    // optimistic
    setSongs((prev) => prev.map((s) => s.id === song.id ? { ...s, is_favorite: !s.is_favorite } : s));
    try { await api(`/library/favorite/${song.id}`, { method: "POST" }); }
    catch { load(); }
  };

  const searchLower = search.trim().toLowerCase();
  const filteredSongs = searchLower
    ? songs.filter((s) =>
        s.title.toLowerCase().includes(searchLower) ||
        s.tags.toLowerCase().includes(searchLower))
    : songs;

  const bottomPad = insets.bottom + 70 + (current ? 70 : 0) + 16;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>YOUR LIBRARY</Text>
        <Text style={styles.title}>Suno catalog</Text>
        <Text style={styles.sub}>{songs.length} {songs.length === 1 ? "track" : "tracks"}</Text>
      </View>

      {songs.length > 0 && (
        <View style={styles.searchWrap}>
          <Feather name="search" size={15} color={colors.textMuted} />
          <TextInput
            testID="library-search"
            value={search}
            onChangeText={setSearch}
            placeholder="Search title or tag"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Feather name="x" size={15} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
      )}

      <FlatList
        testID="library-list"
        data={filteredSongs}
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
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Image
                source={require("../../assets/images/empty-vinyl.png")}
                style={styles.emptyArt}
                resizeMode="contain"
              />
              <Text style={styles.emptyTitle}>Your library is empty</Text>
              <Text style={styles.emptyText}>
                Sign in to Suno inside the app and we'll pull every track you've made.
              </Text>
              <Pressable
                testID="connect-suno-cta"
                onPress={() => router.push("/connect-suno")}
                style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Feather name="zap" size={16} color="#0A0A0A" />
                <Text style={styles.ctaText}>Connect Suno</Text>
              </Pressable>
            </View>
          )
        }
        ListHeaderComponent={
          songs.length > 0 ? (
            <Pressable
              testID="reimport-btn"
              onPress={() => router.push("/connect-suno")}
              style={({ pressed }) => [styles.reimportBtn, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Feather name="refresh-cw" size={14} color={colors.accent} />
              <Text style={styles.reimportText}>Sync from Suno</Text>
            </Pressable>
          ) : null
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
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 8,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14 },
  reimportBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginVertical: 4,
    marginRight: 4,
    borderRadius: 16,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: "rgba(255,140,0,0.3)",
  },
  reimportText: { color: colors.accent, fontSize: 12, fontWeight: "700" },
  empty: { alignItems: "center", paddingTop: 40, paddingHorizontal: 32 },
  emptyArt: { width: 200, height: 200, opacity: 0.85 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: "700", marginTop: 16 },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 8 },
  cta: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: 22, paddingHorizontal: 22, height: 48,
    borderRadius: 24, backgroundColor: colors.accent,
    shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  ctaText: { color: "#0A0A0A", fontWeight: "800", fontSize: 15 },
});
