/**
 * Connect Suno: WebView importer wired to CynLabs backend.
 *
 * Mechanism (unchanged):
 *  - Open suno.com/me in a WebView
 *  - Inject JS that hooks fetch/XHR BEFORE content loads
 *  - Capture clip arrays from Suno's own authenticated API responses
 *  - Filter strict: only is_public=true clips (no drafts, no losing versions)
 *  - Remap to CynLabs schema and POST to https://cynlabs.xyz/api/songs/import
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
import { api, type ImportResult } from "@/src/api/client";
import { colors } from "@/src/theme";

// JS injected into suno.com before content loads. Hooks fetch + XHR, filters to
// is_public, and posts a normalized payload back to the React Native bridge.
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

  // Remap Suno clip -> CynLabs songs/import schema (camelCase).
  function normalize(c) {
    var meta = c.metadata || {};
    var tags = meta.tags || c.tags || '';
    var firstTag = (tags.split(/[,|]+/)[0] || '').trim();
    return {
      sunoId: c.id || c.clip_id,
      title: c.title || 'Untitled',
      artist: c.display_name || (c.user && c.user.display_name) || c.handle || (c.user && c.user.handle) || null,
      genre: firstTag || null,
      tags: tags || null,
      lyrics: meta.prompt || c.prompt || null,
      audioUrl: c.audio_url || null,
      imageUrl: c.image_large_url || c.image_url || null,
      duration: (typeof meta.duration === 'number' ? meta.duration : (typeof c.duration === 'number' ? c.duration : null)),
      bpm: (typeof meta.bpm === 'number' ? Math.round(meta.bpm) : null),
      key: meta.key || null,
      style: meta.style || meta.gpt_description_prompt || null,
      model: c.model_name || meta.model_name || null,
      isPublic: true,
      status: 'published',
    };
  }

  function handlePayload(url, data) {
    var clips = extractClips(data);
    if (!clips.length) return;
    var published = clips.filter(isPublished);
    if (!published.length) return;
    var songs = published.map(normalize).filter(function(s) { return s.sunoId && s.audioUrl && s.title; });
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
  const [capturedCount, setCapturedCount] = useState(0);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const seenIds = useRef<Set<string>>(new Set());
  const buffer = useRef<any[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totals = useRef<ImportResult>({ imported: 0, skipped: 0, total: 0 });

  const flush = useCallback(async () => {
    if (!buffer.current.length) return;
    const batch = buffer.current.slice();
    buffer.current = [];
    setStatus("capturing");
    try {
      const res = await api<ImportResult>("/songs/import", {
        method: "POST",
        body: { songs: batch },
      });
      totals.current = {
        imported: totals.current.imported + (res.imported || 0),
        skipped: totals.current.skipped + (res.skipped || 0),
        total: res.total ?? totals.current.total,
        errors: [...(totals.current.errors || []), ...(res.errors || [])],
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
          if (!s || !s.sunoId || seenIds.current.has(s.sunoId)) continue;
          seenIds.current.add(s.sunoId);
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
        "Open your profile or songs page on Suno so your published tracks load — we'll grab them automatically.",
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
            {status === "loading"
              ? "Loading…"
              : capturedCount > 0
                ? `${capturedCount} ${capturedCount === 1 ? "track" : "tracks"} captured`
                : "Sign in to your Suno account"}
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
          <Text style={styles.doneTitle}>Imported to CynLabs</Text>
          <Text style={styles.doneSub}>
            {importResult.imported} new · {importResult.skipped} skipped · {importResult.total} total
          </Text>
          {importResult.errors && importResult.errors.length > 0 ? (
            <Text style={styles.doneNote}>
              {importResult.errors.length} item{importResult.errors.length === 1 ? "" : "s"} had errors and were skipped.
            </Text>
          ) : null}
          <Pressable testID="back-to-library" onPress={close} style={styles.doneCta}>
            <Text style={styles.doneCtaText}>Open library</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.banner}>
            <Feather name="info" size={14} color={colors.accent} />
            <Text style={styles.bannerText}>
              Sign in to Suno below, then open your profile or songs page.{"\n"}
              We only capture tracks you've published publicly.
            </Text>
          </View>

          <View style={styles.webWrap}>
            <WebView
              ref={webRef}
              testID="suno-webview"
              source={{ uri: "https://suno.com/me" }}
              injectedJavaScriptBeforeContentLoaded={SNIFFER}
              onMessage={onMessage}
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
  doneNote: { color: colors.textDim, fontSize: 12, textAlign: "center", marginTop: 4 },
  doneCta: {
    marginTop: 18,
    paddingHorizontal: 28, height: 48, borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center",
  },
  doneCtaText: { color: "#0A0A0A", fontWeight: "800", fontSize: 15 },
});
