import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";

export default function SignupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (!email.trim() || password.length < 6) {
      setError("Use a valid email and a password of at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      await register(email.trim().toLowerCase(), password);
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e?.message ?? "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.heroWrap}>
        <Image source={require("../../assets/images/auth-hero.png")} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <LinearGradient
          colors={["rgba(10,10,10,0)", "rgba(10,10,10,0.7)", colors.bg]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.brandDot} />
          <Text style={styles.brandText}>SUNO LIBRARY</Text>
        </View>

        <View style={styles.spacer} />

        <Text style={styles.title}>Create your{"\n"}listening room.</Text>
        <Text style={styles.subtitle}>
          One account. Every track you've made. Native playback, favorites, queues — all yours.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <View style={styles.inputWrap}>
            <Feather name="mail" size={16} color={colors.textMuted} />
            <TextInput
              testID="signup-email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textDim}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </View>

          <Text style={styles.label}>Password</Text>
          <View style={styles.inputWrap}>
            <Feather name="lock" size={16} color={colors.textMuted} />
            <TextInput
              testID="signup-password"
              value={password}
              onChangeText={setPassword}
              placeholder="at least 6 characters"
              placeholderTextColor={colors.textDim}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={14} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            testID="signup-submit"
            onPress={onSubmit}
            disabled={loading}
            style={({ pressed }) => [styles.cta, { opacity: pressed || loading ? 0.85 : 1 }]}
          >
            {loading ? <ActivityIndicator color="#0A0A0A" /> : <Text style={styles.ctaText}>Create account</Text>}
          </Pressable>

          <Pressable testID="go-to-login" onPress={() => router.replace("/(auth)/login")} style={styles.switchBtn}>
            <Text style={styles.switchText}>
              Already have one? <Text style={styles.switchAccent}>Sign in</Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  heroWrap: { ...StyleSheet.absoluteFillObject, height: "55%" },
  scroll: { flexGrow: 1, paddingHorizontal: 24, justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 8 },
  brandText: { color: colors.text, fontSize: 12, letterSpacing: 2.5, fontWeight: "700" },
  spacer: { height: 180 },
  title: { color: colors.text, fontSize: 36, fontWeight: "800", lineHeight: 42, letterSpacing: -1 },
  subtitle: { color: colors.textMuted, fontSize: 15, marginTop: 12, lineHeight: 22 },
  card: {
    marginTop: 28,
    padding: 18,
    borderRadius: 20,
    backgroundColor: "rgba(20,20,20,0.85)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.2, fontWeight: "700", marginBottom: 8, marginTop: 6 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 50,
    marginBottom: 6,
  },
  input: { flex: 1, color: colors.text, fontSize: 15 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderColor: "rgba(239,68,68,0.4)",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  errorText: { color: colors.danger, fontSize: 13, flex: 1 },
  cta: {
    marginTop: 18,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  ctaText: { color: "#0A0A0A", fontWeight: "800", fontSize: 16, letterSpacing: 0.3 },
  switchBtn: { alignItems: "center", marginTop: 14, paddingVertical: 6 },
  switchText: { color: colors.textMuted, fontSize: 13 },
  switchAccent: { color: colors.accent, fontWeight: "700" },
});
