import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { usePlayer } from "@/src/context/PlayerContext";
import { colors } from "@/src/theme";

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { current, stop } = usePlayer();

  const onLogout = () => {
    Alert.alert("Sign out?", "You'll need to sign in again to see your library.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out", style: "destructive",
        onPress: async () => {
          stop();
          await logout();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  const onClearLibrary = () => {
    Alert.alert(
      "Clear library?",
      "This removes all imported tracks from this app. Your Suno account is not touched.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear", style: "destructive",
          onPress: async () => {
            try {
              stop();
              await api("/library", { method: "DELETE" });
              Alert.alert("Done", "Library cleared.");
            } catch (e: any) {
              Alert.alert("Failed", e?.message ?? "Could not clear library");
            }
          },
        },
      ],
    );
  };

  const bottomPad = insets.bottom + 70 + (current ? 70 : 0) + 16;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>ACCOUNT</Text>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPad, gap: 16 }}>
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Feather name="user" size={22} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Signed in as</Text>
            <Text testID="account-email" style={styles.value}>{user?.email}</Text>
          </View>
        </View>

        <Pressable
          testID="account-sync"
          onPress={() => router.push("/connect-suno")}
          style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.8 }]}
        >
          <Feather name="refresh-cw" size={18} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Sync from Suno</Text>
            <Text style={styles.actionSub}>Pull the latest tracks from your Suno profile</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textDim} />
        </Pressable>

        <Pressable
          testID="account-clear"
          onPress={onClearLibrary}
          style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.8 }]}
        >
          <Feather name="trash-2" size={18} color={colors.danger} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionTitle, { color: colors.danger }]}>Clear local library</Text>
            <Text style={styles.actionSub}>Doesn't affect your Suno account</Text>
          </View>
        </Pressable>

        <Pressable
          testID="account-logout"
          onPress={onLogout}
          style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.8 }]}
        >
          <Feather name="log-out" size={18} color={colors.textMuted} />
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Sign out</Text>
          </View>
        </Pressable>

        <Text style={styles.footer}>Suno Library · v1.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6 },
  headerLabel: { color: colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  title: { color: colors.text, fontSize: 32, fontWeight: "800", letterSpacing: -1, marginTop: 4 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.accentSoft,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,140,0,0.3)",
  },
  label: { color: colors.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  value: { color: colors.text, fontSize: 15, fontWeight: "600", marginTop: 4 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  actionSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  footer: { color: colors.textDim, fontSize: 12, textAlign: "center", marginTop: 24 },
});
