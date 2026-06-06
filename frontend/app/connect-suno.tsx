import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { api, type ImportResult } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { colors } from "@/src/theme";

const HANDLE_KEY = "suno_handle";

// Injected before content loads. Hooks fetch + XHR, filters to is_public,
// and posts a normalized payload back to the React Native bridge.
// Output shape matches the backend SongIn schema (snake_case).
const SNIFFER = `
(function() {
  if (window.__cynSniffer) return;
  window.__cynSniffer = true;

  function post(payload) {
    try {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } catch (e) {}
  }

  post({ type: 'sniffer_ready', url: window.location.href });

  function looksLikeClip(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return ('audio_url' in obj) || ('metadata' in obj && obj.metadata && ('tags' in obj.metadata || 'prompt' in obj.metadata));
  }

  function isPublished(c) {
    if (!c) return false;
    if (c.is_trashed === true) return false;
    if (c.is_public === true) return true;
    if (c.public === true) return true;
    if (c.is_published === true) return true;
    if (c.clip && (c.clip.is_public === true || c.clip.public === true)) return true;
    return false;
  }

  function extractClips(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data.filter(looksLikeClip);
    if (typeof data === 'object') {
      if (Array.isArray(data.clips)) return data.clips.filter(looksLikeClip);
      for (var k in data) {
        var v = data[k];
        if (Array.isArray(v) && v.length && looksLikeClip(v[0])) return v.filter(looksLikeClip);
      }
    }
    return [];
  }

  // Output matches backend SongIn: snake_case fields.
  function normalize(c) {
    var meta = c.metadata || {};
    var tags = meta.tags || c.tags || '';
    return {
      id: c.id || c.clip_id,
      title: c.title || 'Untitled',
      audio_url: c.audio_url || null,
      image_url: c.image_large_url || c.image_url || null,
      tags: tags || '',
      prompt: meta.prompt || c.prompt || '',
      duration: (typeof meta.duration === 'number' ? meta.duration : (typeof c.duration === 'number' ? c.duration : null)),
      play_count: c.play_count || 0,
      like_count: c.like_count || 0,
      created_at: c.created_at || null,
      handle: c.handle || (c.user && c.user.handle) || null,
      display_name: c.display_name || (c.user && c.user.display_name) || null,
      is_public: true,
    };
  }

  function handlePayload(url, data) {
    var clips = extractClips(data);
    if (!clips.length) return;
    var published = clips.filter(isPublished);
    if (!published.length) return;
    var songs = published.map(normalize).filter(function(s) { return s.id && s.audio_url && s.title; });
    if (!songs.length) return;
    post({ type: 'songs', count: songs.length, url: url, songs: songs });
  }

  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    return origFetch.apply(this, arguments).then(function(res) {
      try {
        var ct = res.headers.get('content-type') || '';
        if (ct.indexOf('application/json') !== -1) {
          res.clone().json().then(function(data) {
            try { handlePayload(url, data); } catch (e) {}
          }).catch(function(){});
        }
      } catch (e) {}
      return res;
    });
  };

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__cynUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    var self = this;
    var prev = self.onreadystatechange;
    self.onreadystatechange = function() {
      if (self.readyState === 4) {
        try {
          var ct = self.getResponseHeader && self.getResponseHeader('content-type') || '';
          if (ct.indexOf('application/json') !== -1 && self.responseText) {
            try {
              var data = JSON.parse(self.responseText);
              handlePayload(self.__cynUrl || '', data);
            } catch (e) {}
          }
        } catch (e) {}
      }
      if (prev) prev.apply(self, arguments);
    };
    return origSend.apply(self, arguments);
  };

  var lastUrl = location.href;
  setInterval(function() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      post({ type: 'url', url: lastUrl });
    }
  }, 600);
})();
true;
`;

type Status = "loading" | "ready" | "capturing" | "done" | "error";
type PageTab = "profile" | "songs";

export default function CynLabsImportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [capturedCount, setCapturedCount] = useState(0);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const seenIds = useRef<Set<string>>(new Set());
  const buffer = useRef<any[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totals = useRef<ImportResult>({ inserted: 0, updated: 0, total: 0 });

  const [handle, setHandle] = useState<string | null>(null);
  const [handleInput, setHandleInput] = useState("");
  const [handleLoaded, setHandleLoaded] = useState(false);
  const [pageTab, setPageTab] = useState<PageTab>("profile");

  useEffect(() => {
    (async () => {
      const stored = await storage.getItem<string>(HANDLE_KEY, "");
      if (stored) {
        setHandle(stored);
        setHandleInput(stored);
      }
      setHandleLoaded(true);
    })();
  }, []);

  const profileUrl = handle ? `https://suno.com/@${handle}` : "";
  const songsUrl = handle ? `https://suno.com/@${handle}/songs` : "";
  const webUri = pageTab === "songs" ? songsUrl : profileUrl;

  const saveHandle = useCallback(async (raw: string) => {
    const cleaned = raw.trim().replace(/^@+/, "").replace(/\s+/g, "");
    if (!cleaned) return;
    await storage.setItem(HANDLE_KEY, cleaned);
    setHandle(cleaned);
    setPageTab("profile");
  }, []);

  const changeHandle = useCallback(() => {
    setHandle(null);
    setStatus("loading");
    setCapturedCount(0);
    setPageTab("profile");
    seenIds.current.clear();
    buffer.current = [];
    totals.current = { inserted: 0, updated: 0, total: 0 };
  }, []);

  const switchTab = useCallback((tab: PageTab) => {
    setPageTab(tab);
    setStatus("loading");
  }, []);

  const flush = useCallback(async () => {
    if (!buffer.current.length) return;
    const batch = buffer.current.slice().map((song) =>
      Object.fromEntries(Object.entries(song).filter(([, v]) => v !== null)),
    );
    buffer.current = [];
    setStatus("capturing");
    try {
      const res = await api<ImportResult>("/library/import", {
        method: "POST",
        body: { songs: batch },
      });
      totals.current = {
        inserted: (totals.current.inserted || 0) + (res.inserted || 0),
        updated: (totals.current.updated || 0) + (res.updated || 0),
        total: res.total ?? totals.current.total,
      };
      setImportResult({ ...totals.current });
    } catch (e: any) {
      setError(e?.message ?? "Import failed");
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => { flush(); }, 800);
  }, [flush]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "sniffer_ready") {
        setStatus("ready");
      } else if (msg.type === "songs" && Array.isArray(msg.songs)) {
        const fresh: any[] = [];
        for (const s of msg.songs) {
          if (!s || !s.id || seenIds.current.has(s.id)) continue;
          seenIds.current.add(s.id);
          fresh.push(s);
        }
        if (fresh.length) {
          buffer.current.push(...fresh);
          setCapturedCount(seenIds.current.size);
          scheduleFlush();
        }
      }
    } catch (err) {
      console.warn("bad webview message", err);
    }
  }, [scheduleFlush]);

  const finishImport = async () => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    await flush();
    if (capturedCount === 0) {
      Alert.alert(
        "No tracks captured yet",
        "Browse your profile or songs page so your published tracks load — we'll capture them automatically.",
      );
      return;
    }
    setStatus("done");
  };

  const close = () => router.back();

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="connect-close" onPress={close} hitSlop={10} style={styles.iconBtn}>
          <Feather name="x" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.topInfo}>
          <Text style={styles.topTitle}>CynLabs Import</Text>
          <Text style={styles.topSub} numberOfLines={1}>
            {!handle
              ? "Enter your username"
              : status === "loading"
                ? `Loading @${handle}…`
                : capturedCount > 0
                  ? `${capturedCount} ${capturedCount === 1 ? "track" : "tracks"} captured`
                  : `Browsing @${handle}`}
          </Text>
        </View>
        {handle && capturedCount > 0 && status !== "done" ? (
          <Pressable
            testID="connect-finish"
            onPress={finishImport}
            style={({ pressed }) => [styles.finishBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.finishText}>Done</Text>
          </Pressable>
        ) : handle ? (
          <Pressable
            testID="change-handle"
            onPress={changeHandle}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <Feather name="edit-2" size={18} color={colors.textMuted} />
          </Pressable>
        ) : (
          <View style={styles.iconBtn} />
        )}
      </View>

      {status === "done" && importResult ? (
        <View style={styles.doneCard}>
          <View style={styles.doneIcon}>
            <Feather name="check" size={28} color="#0A0A0A" />
          </View>
          <Text style={styles.doneTitle}>Imported to CynLabs</Text>
          <Text style={styles.doneSub}>
            {importResult.inserted} new · {importResult.updated} updated · {importResult.total} total
          </Text>
          <Pressable testID="back-to-library" onPress={close} style={styles.doneCta}>
            <Text style={styles.doneCtaText}>Open library</Text>
          </Pressable>
        </View>
      ) : !handleLoaded ? (
        <View style={styles.handleLoading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : !handle ? (
        <ScrollView
          contentContainerStyle={styles.handleWrap}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <View style={styles.handleCard}>
            <Feather name="at-sign" size={28} color={colors.accent} />
            <Text style={styles.handleTitle}>What's your username?</Text>
            <Text style={styles.handleSub}>
              We'll load your public songs.{"\n\n"}
              Only published tracks will be imported — drafts are excluded automatically.
            </Text>
            <View style={styles.handleInputWrap}>
              <Text style={styles.atPrefix}>@</Text>
              <TextInput
                testID="handle-input"
                value={handleInput}
                onChangeText={setHandleInput}
                placeholder="your-username"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                style={styles.handleInput}
                onSubmitEditing={() => saveHandle(handleInput)}
                returnKeyType="go"
              />
            </View>
            <Pressable
              testID="handle-continue"
              disabled={!handleInput.trim()}
              onPress={() => saveHandle(handleInput)}
              style={({ pressed }) => [
                styles.handleCta,
                { opacity: !handleInput.trim() ? 0.4 : pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.handleCtaText}>Continue</Text>
              <Feather name="arrow-right" size={16} color="#0A0A0A" />
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <>
          <View style={styles.navBar}>
            <Pressable
              onPress={() => switchTab("profile")}
              style={[styles.navTab, pageTab === "profile" && styles.navTabActive]}
            >
              <Text style={[styles.navTabText, pageTab === "profile" && styles.navTabTextActive]}>
                Profile
              </Text>
            </Pressable>
            <Pressable
              onPress={() => switchTab("songs")}
              style={[styles.navTab, pageTab === "songs" && styles.navTabActive]}
            >
              <Text style={[styles.navTabText, pageTab === "songs" && styles.navTabTextActive]}>
                Songs
              </Text>
              <Feather
                name="chevron-right"
                size={12}
                color={pageTab === "songs" ? "#0A0A0A" : colors.textMuted}
              />
            </Pressable>
            <Text style={styles.navHint}>Scroll to load more, then tap Done</Text>
          </View>

          <View style={styles.webWrap}>
            <WebView
              ref={webRef}
              testID="suno-webview"
              source={{ uri: webUri }}
              injectedJavaScriptBeforeContentLoaded={SNIFFER}
              onMessage={onMessage}
              onError={(e) => setError(e.nativeEvent.description ?? "Failed to load page")}
              onNavigationStateChange={() => {
                webRef.current?.injectJavaScript(SNIFFER);
              }}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              originWhitelist={["*"]}
              setSupportMultipleWindows={false}
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
              renderLoading={() => (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              )}
              userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
              style={{ flex: 1, backgroundColor: colors.bg }}
            />
          </View>

          {error ? (
            <View style={styles.errorBar}>
              <Feather name="alert-circle" size={14} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  topInfo: { flex: 1, marginHorizontal: 12 },
  topTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  topSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  finishBtn: {
    paddingHorizontal: 16,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  finishText: { color: "#0A0A0A", fontWeight: "800", fontSize: 14 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 12,
    marginVertical: 8,
  },
  navTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  navTabActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  navTabText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  navTabTextActive: { color: "#0A0A0A" },
  navHint: { flex: 1, color: colors.textDim, fontSize: 11, textAlign: "right" },
  webWrap: { flex: 1, marginHorizontal: 8, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  errorBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
  },
  errorText: { color: colors.danger, fontSize: 12, flex: 1 },
  doneCard: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  doneIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center",
    shadowColor: colors.accent, shadowOpacity: 0.5, shadowRadius: 18,
  },
  doneTitle: { color: colors.text, fontSize: 22, fontWeight: "800", marginTop: 6 },
  doneSub: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
  doneCta: {
    marginTop: 18,
    paddingHorizontal: 28, height: 48, borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center",
  },
  doneCtaText: { color: "#0A0A0A", fontWeight: "800", fontSize: 15 },
  handleLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  handleWrap: { flexGrow: 1, padding: 24, justifyContent: "center" },
  handleCard: {
    padding: 24,
    borderRadius: 20,
    backgroundColor: "rgba(20,20,20,0.85)",
    borderWidth: 1,
    borderColor: colors.border,
    gap: 14,
  },
  handleTitle: { color: colors.text, fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  handleSub: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  handleInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 52,
    marginTop: 4,
  },
  atPrefix: { color: colors.textMuted, fontSize: 18, fontWeight: "600", marginRight: 4 },
  handleInput: { flex: 1, color: colors.text, fontSize: 16 },
  handleCta: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  handleCtaText: { color: "#0A0A0A", fontWeight: "800", fontSize: 15 },
});
