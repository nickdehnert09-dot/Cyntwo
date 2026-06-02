import { AntDesign, Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signInWithGoogle, signingIn } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async () => {
    setError(null);
    try {
      await signInWithGoogle();
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e?.message ?? "Sign in failed");
    }
  };

  return (
    <View style={styles.flex}>
      <View style={styles.heroWrap}>
        <Image
          source={require("../../assets/images/auth-hero.png")}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
        <LinearGradient
          colors={["rgba(10,10,10,0)", "rgba(10,10,10,0.7)", colors.bg]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.brandDot} />
          <Text style={styles.brandText}>SUNO · CYNLABS</Text>
        </View>

        <View style={styles.spacer} />

        <Text style={styles.title}>Your library.{"\n"}Your sound.</Text>
        <Text style={styles.subtitle}>
          Sign in with the Google account on your CynLabs profile to import your published Suno catalog.
        </Text>

        <View style={styles.card}>
          <Pressable
            testID="google-signin"
            onPress={onSignIn}
            disabled={signingIn}
            style={({ pressed }) => [
              styles.googleBtn,
              { opacity: pressed || signingIn ? 0.85 : 1 },
            ]}
          >
            {signingIn ? (
              <ActivityIndicator color="#0A0A0A" />
            ) : (
              <>
                <AntDesign name="google" size={18} color="#0A0A0A" />
                <Text style={styles.googleBtnText}>Sign in with Google</Text>
              </>
            )}
          </Pressable>

          {error ? (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={14} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Text style={styles.legal}>
            We open Google's sign-in inside your browser. Your password never touches this app.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  heroWrap: { ...StyleSheet.absoluteFillObject, height: "55%" },
  scroll: { flexGrow: 1, paddingHorizontal: 24, justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 8 },
  brandText: { color: colors.text, fontSize: 12, letterSpacing: 2.5, fontWeight: "700" },
  spacer: { height: 220 },
  title: { color: colors.text, fontSize: 38, fontWeight: "800", lineHeight: 44, letterSpacing: -1 },
  subtitle: { color: colors.textMuted, fontSize: 15, marginTop: 12, lineHeight: 22 },
  card: {
    marginTop: 32,
    padding: 18,
    borderRadius: 20,
    backgroundColor: "rgba(20,20,20,0.85)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  googleBtnText: { color: "#0A0A0A", fontWeight: "800", fontSize: 16, letterSpacing: 0.2 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderColor: "rgba(239,68,68,0.4)",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  errorText: { color: colors.danger, fontSize: 13, flex: 1 },
  legal: {
    color: colors.textDim,
    fontSize: 12,
    textAlign: "center",
    marginTop: 14,
    lineHeight: 17,
  },
});
