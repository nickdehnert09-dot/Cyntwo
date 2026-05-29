/**
 * Connect Suno: the WebView importer.
 *
 * Strategy:
 *  1. Open suno.com inside an in-app WebView.
 *  2. Before the page loads, inject JS that monkey-patches window.fetch and XMLHttpRequest
 *     so we can inspect every API response Suno's own SPA makes.
 *  3. When we see responses that look like clip lists (key shape: `clips` array, or
 *     an array of objects with `audio_url` / `metadata` fields), we extract them and
 *     postMessage them back to React Native.
 *  4. RN buffers them, dedupes by id, and posts to our backend `/library/import`.
 *
 * This works because the JS runs inside suno.com's origin, so Clerk's HttpOnly session
 * cookie is automatically included by the browser — we never need to touch it ourselves.
 */
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";

// Injected before page content loads — hooks fetch / XHR.
const SNIFFER = `
(function() {
  if (window.__sunoSniffer) return;
  window.__sunoSniffer = true;

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

  function extractClips(data) {
    if (!data) return [];
    if (Array.isArray(data)) {
      return data.filter(looksLikeClip);
    }
    if (typeof data === 'object') {
      if (Array.isArray(data.clips)) return data.clips.filter(looksLikeClip);
      // Recurse one level deep for nested wrappers (data.data, data.results, etc.)
      for (const k of Object.keys(data)) {
        const v = data[k];
        if (Array.isArray(v) && v.length && looksLikeClip(v[0])) return v.filter(looksLikeClip);
      }
    }
    return [];
  }

  function normalize(c) {
    var meta = c.metadata || {};
    return {
      id: c.id || c.clip_id,
      title: c.title || 'Untitled',
      audio_url: c.audio_url || null,
      image_url: c.image_url || c.image_large_url || null,
      video_url: c.video_url || null,
      tags: meta.tags || c.tags || '',
      prompt: meta.prompt || c.prompt || '',
      duration: meta.duration || c.duration || null,
      play_count: c.play_count || 0,
      like_count: c.upvote_count || c.like_count || 0,
      created_at: c.created_at || null,
      handle: (c.handle) || (c.user && c.user.handle) || null,
      display_name: (c.display_name) || (c.user && c.user.display_name) || null,
    };
  }

  function handlePayload(url, data) {
    var clips = extractClips(data);
    if (!clips.length) return;
    var songs = clips.map(normalize).filter(function(s) { return s.id && s.audio_url; });
    if (!songs.length) return;
    post({ type: 'songs', count: songs.length, url: url, songs: songs });
  }

  // --- fetch hook ---
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

  // --- XHR hook ---
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__sunoUrl = url;
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
              handlePayload(self.__sunoUrl || '', data);
            } catch (e) {}
          }
        } catch (e) {}
      }
      if (prev) prev.apply(self, arguments);
    };
    return origSend.apply(self, arguments);
  };

  // Re-post readiness on navigation so we know which screen the user is on.
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

export default function ConnectSunoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [currentUrl, setCurrentUrl] = useState("");
  const [capturedCount, setCapturedCount] = useState(0);
  const [importResult, setImportResult] = useState<{ inserted: number; updated: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const seenIds = useRef<Set<string>>(new Set());
  const buffer = useRef<any[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (!buffer.current.length) return;
    const batch = buffer.current.slice();
    buffer.current = [];
    setStatus("capturing");
    try {
      const res = await api<{ inserted: number; updated: number; total: number }>("/library/import", {
        method: "POST",
        body: { songs: batch },
      });
      setImportResult(res);
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
      } else if (msg.type === "url") {
        setCurrentUrl(msg.url);
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
        "Open your profile or the 'Me' page on Suno so your songs load — they'll import automatically.",
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
          <Text style={styles.topTitle}>Connect Suno</Text>
          <Text style={styles.topSub} numberOfLines={1}>
            {status === "loading" ? "Loading…" :
             capturedCount > 0 ? `${capturedCount} tracks captured` :
             "Sign in to your Suno account"}
          </Text>
        </View>
        {capturedCount > 0 && status !== "done" ? (
          <Pressable
            testID="connect-finish"
            onPress={finishImport}
            style={({ pressed }) => [styles.finishBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.finishText}>Done</Text>
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
          <Text style={styles.doneTitle}>Library imported</Text>
          <Text style={styles.doneSub}>
            {importResult.inserted} new · {importResult.updated} updated · {importResult.total} total
          </Text>
          <Pressable testID="back-to-library" onPress={close} style={styles.doneCta}>
            <Text style={styles.doneCtaText}>Open library</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.banner}>
            <Feather name="info" size={14} color={colors.accent} />
            <Text style={styles.bannerText}>
              Sign in to Suno below. We listen for your tracks as the page loads them.
            </Text>
          </View>

          <View style={styles.webWrap}>
            <WebView
              ref={webRef}
              testID="suno-webview"
              source={{ uri: "https://suno.com/me" }}
              injectedJavaScriptBeforeContentLoaded={SNIFFER}
              onMessage={onMessage}
              onLoadStart={() => setStatus((s) => s === "loading" ? "loading" : s)}
              onError={(e) => setError(e.nativeEvent.description ?? "Failed to load Suno")}
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
              <Pressable onPress={() => Linking.openURL("https://suno.com")} hitSlop={6}>
                <Text style={styles.errorLink}>Open in browser</Text>
              </Pressable>
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
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: "rgba(255,140,0,0.25)",
  },
  bannerText: { color: colors.text, fontSize: 12, flex: 1, lineHeight: 17 },
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
  errorLink: { color: colors.accent, fontSize: 12, fontWeight: "700" },
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
});
