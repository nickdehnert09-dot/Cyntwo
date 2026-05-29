import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import type { Song } from "@/src/api/client";

export type RepeatMode = "off" | "all" | "one";

type PlayerState = {
  queue: Song[];
  currentIndex: number;
  current: Song | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  shuffle: boolean;
  repeat: RepeatMode;
  playFromList: (songs: Song[], index: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (ms: number) => void;
  setShuffle: (v: boolean) => void;
  cycleRepeat: () => void;
  stop: () => void;
};

const Ctx = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Song[]>([]);
  const [shuffleOrder, setShuffleOrder] = useState<number[] | null>(null); // indexes into queue
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [shuffle, setShuffleState] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");

  const playerRef = useRef<AudioPlayer | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // configure audio mode once
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    }).catch(() => {});
  }, []);

  const current = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  // poll player state
  useEffect(() => {
    if (!playerRef.current) return;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      setPositionMs(Math.floor((p.currentTime || 0) * 1000));
      const d = p.duration || 0;
      if (d > 0) setDurationMs(Math.floor(d * 1000));
      setIsPlaying(!!p.playing);
      // handle end-of-track
      if (d > 0 && p.currentTime >= d - 0.25 && !p.playing) {
        handleTrackEnd();
      }
    }, 500);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, queue, repeat, shuffle]);

  const loadAndPlay = useCallback((song: Song) => {
    try {
      if (playerRef.current) {
        playerRef.current.remove();
        playerRef.current = null;
      }
      if (!song.audio_url) return;
      const p = createAudioPlayer({ uri: song.audio_url });
      playerRef.current = p;
      p.play();
      setIsPlaying(true);
      setPositionMs(0);
      setDurationMs(0);
    } catch (e) {
      console.warn("loadAndPlay failed", e);
    }
  }, []);

  const playIndex = useCallback((idx: number, q: Song[]) => {
    if (idx < 0 || idx >= q.length) return;
    setCurrentIndex(idx);
    loadAndPlay(q[idx]);
  }, [loadAndPlay]);

  const playFromList = useCallback((songs: Song[], index: number) => {
    const playable = songs.filter((s) => !!s.audio_url);
    if (!playable.length) return;
    const startSong = songs[index];
    const startIdx = Math.max(0, playable.findIndex((s) => s.id === startSong?.id));
    setQueue(playable);
    setShuffleOrder(shuffle ? buildShuffle(playable.length, startIdx) : null);
    playIndex(startIdx, playable);
  }, [playIndex, shuffle]);

  const positionInPlayOrder = useCallback((idx: number): number => {
    if (!shuffleOrder) return idx;
    return shuffleOrder.indexOf(idx);
  }, [shuffleOrder]);

  const nextIndexFor = useCallback((dir: 1 | -1): number => {
    if (!queue.length || currentIndex < 0) return -1;
    if (repeat === "one") return currentIndex;
    if (shuffleOrder) {
      const pos = positionInPlayOrder(currentIndex);
      const newPos = pos + dir;
      if (newPos < 0) {
        return repeat === "all" ? shuffleOrder[shuffleOrder.length - 1] : -1;
      }
      if (newPos >= shuffleOrder.length) {
        return repeat === "all" ? shuffleOrder[0] : -1;
      }
      return shuffleOrder[newPos];
    }
    const newIdx = currentIndex + dir;
    if (newIdx < 0) return repeat === "all" ? queue.length - 1 : -1;
    if (newIdx >= queue.length) return repeat === "all" ? 0 : -1;
    return newIdx;
  }, [currentIndex, queue.length, repeat, shuffleOrder, positionInPlayOrder]);

  const next = useCallback(() => {
    const n = nextIndexFor(1);
    if (n >= 0) playIndex(n, queue);
    else {
      if (playerRef.current) playerRef.current.pause();
      setIsPlaying(false);
    }
  }, [nextIndexFor, playIndex, queue]);

  const prev = useCallback(() => {
    // if more than 3s in, restart current
    if (positionMs > 3000 && playerRef.current) {
      playerRef.current.seekTo(0);
      setPositionMs(0);
      return;
    }
    const n = nextIndexFor(-1);
    if (n >= 0) playIndex(n, queue);
  }, [nextIndexFor, playIndex, queue, positionMs]);

  const handleTrackEnd = useCallback(() => {
    if (repeat === "one") {
      if (playerRef.current) {
        playerRef.current.seekTo(0);
        playerRef.current.play();
      }
      return;
    }
    next();
  }, [next, repeat]);

  const toggle = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) {
      p.pause();
      setIsPlaying(false);
    } else {
      p.play();
      setIsPlaying(true);
    }
  }, []);

  const seekTo = useCallback((ms: number) => {
    const p = playerRef.current;
    if (!p) return;
    p.seekTo(Math.max(0, ms / 1000));
    setPositionMs(ms);
  }, []);

  const setShuffle = useCallback((v: boolean) => {
    setShuffleState(v);
    if (v && queue.length) {
      setShuffleOrder(buildShuffle(queue.length, currentIndex >= 0 ? currentIndex : 0));
    } else {
      setShuffleOrder(null);
    }
  }, [queue.length, currentIndex]);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));
  }, []);

  const stop = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.pause();
      playerRef.current.remove();
      playerRef.current = null;
    }
    setCurrentIndex(-1);
    setIsPlaying(false);
    setPositionMs(0);
    setDurationMs(0);
  }, []);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try { playerRef.current.remove(); } catch {}
      }
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const value = useMemo<PlayerState>(() => ({
    queue,
    currentIndex,
    current,
    isPlaying,
    positionMs,
    durationMs,
    shuffle,
    repeat,
    playFromList,
    toggle,
    next,
    prev,
    seekTo,
    setShuffle,
    cycleRepeat,
    stop,
  }), [queue, currentIndex, current, isPlaying, positionMs, durationMs, shuffle, repeat, playFromList, toggle, next, prev, seekTo, setShuffle, cycleRepeat, stop]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlayer(): PlayerState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlayer must be inside PlayerProvider");
  return v;
}

function buildShuffle(length: number, startIdx: number): number[] {
  const arr = Array.from({ length }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // ensure start is first
  const at = arr.indexOf(startIdx);
  if (at > 0) {
    [arr[0], arr[at]] = [arr[at], arr[0]];
  }
  return arr;
}
