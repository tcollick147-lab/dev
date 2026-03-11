// src/hooks/useDartSounds.ts – Global audio (dart.wav, bonus.wav, jackpot.wav, killed.wav)
import { useEffect, useState, useCallback, useRef } from "react";
import { Audio } from "expo-av";

type SoundSet = {
  dart: Audio.Sound | null;
  bonus: Audio.Sound | null;
  jackpot: Audio.Sound | null;
  killed: Audio.Sound | null;
};

const DART_DEBOUNCE_MS = 80;
const MAX_CONCURRENT_DART = 3;

export function useDartSounds() {
  const [sounds, setSounds] = useState<SoundSet>({
    dart: null,
    bonus: null,
    jackpot: null,
    killed: null,
  });

  const dartPlayCountRef = useRef(0);
  const dartDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;
    let dart: Audio.Sound | null = null;
    let bonus: Audio.Sound | null = null;
    let jackpot: Audio.Sound | null = null;
    let killed: Audio.Sound | null = null;

    (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });

        const [dartRes, bonusRes, jackpotRes, killedRes] = await Promise.all([
          Audio.Sound.createAsync(require("../../assets/sounds/dart.wav"), {
            shouldPlay: false,
            volume: 0.55,
          }),
          Audio.Sound.createAsync(require("../../assets/sounds/bonus.wav"), {
            shouldPlay: false,
            volume: 0.85,
          }),
          Audio.Sound.createAsync(require("../../assets/sounds/jackpot.wav"), {
            shouldPlay: false,
            volume: 1.0,
          }),
          Audio.Sound.createAsync(require("../../assets/sounds/killed.wav"), {
            shouldPlay: false,
            volume: 0.9,
          }),
        ]);

        dart = dartRes.sound;
        bonus = bonusRes.sound;
        jackpot = jackpotRes.sound;
        killed = killedRes.sound;

        if (mounted)
          setSounds({ dart, bonus, jackpot, killed });
      } catch (e) {
        console.warn("Failed to load sounds", e);
      }
    })();

    return () => {
      mounted = false;
      if (dartDebounceRef.current) clearTimeout(dartDebounceRef.current);
      dart?.unloadAsync();
      bonus?.unloadAsync();
      jackpot?.unloadAsync();
      killed?.unloadAsync();
    };
  }, []);

  const playDart = useCallback(async () => {
    if (!sounds.dart) return;
    if (dartPlayCountRef.current >= MAX_CONCURRENT_DART) return;

    if (dartDebounceRef.current) {
      clearTimeout(dartDebounceRef.current);
      dartDebounceRef.current = null;
    }

    const doPlay = async () => {
      dartPlayCountRef.current += 1;
      try {
        await sounds.dart!.stopAsync();
        await sounds.dart!.setPositionAsync(0);
        await sounds.dart!.playAsync();
      } catch {
        // ignore
      } finally {
        dartPlayCountRef.current = Math.max(0, dartPlayCountRef.current - 1);
      }
    };

    dartDebounceRef.current = setTimeout(() => {
      dartDebounceRef.current = null;
      doPlay();
    }, DART_DEBOUNCE_MS);
  }, [sounds.dart]);

  const playBonus = useCallback(async () => {
    if (!sounds.bonus) return;
    try {
      await sounds.bonus.replayAsync();
    } catch {
      // ignore
    }
  }, [sounds.bonus]);

  const playJackpot = useCallback(async () => {
    if (!sounds.jackpot) return;
    try {
      await sounds.jackpot.replayAsync();
    } catch {
      // ignore
    }
  }, [sounds.jackpot]);

  const playKilled = useCallback(async () => {
    if (!sounds.killed) return;
    try {
      await sounds.killed.replayAsync();
    } catch {
      // ignore
    }
  }, [sounds.killed]);

  return {
    playDart,
    playBonus,
    playJackpot,
    playKilled,
    playHit: playDart,
    playReward: playBonus,
    playWin: playBonus,
  };
}

export default useDartSounds;
