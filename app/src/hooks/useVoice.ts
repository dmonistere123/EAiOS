/**
 * Browser Web Speech API wrapper for EAiOS voice I/O.
 * Provides speech-to-text (STT) input and text-to-speech (TTS) playback.
 * Falls back gracefully when the API is unavailable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { VoiceCapture } from './voiceCapture';

export interface VoiceState {
  supported: boolean;
  playbackSupported: boolean;
  listening: boolean;
  speaking: boolean;
  interim: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  cancelListening: (preserveDraft?: boolean) => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
}

function getSpeechRecognition(): { new (): SpeechRecognition } | null {
  const g = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : undefined;
  if (!g) return null;
  const SR = (g as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  const webkit = (g as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  if (typeof SR === 'function') return SR as { new (): SpeechRecognition };
  if (typeof webkit === 'function') return webkit as { new (): SpeechRecognition };
  return null;
}

export function useVoice(onTranscript: (text: string) => void, onDraft?: (text: string) => void): VoiceState {
  const [supported] = useState(() => !!getSpeechRecognition());
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const captureRef = useRef<VoiceCapture | null>(null);
  const callbacks = useRef({ onTranscript, onDraft });
  useEffect(() => { callbacks.current = { onTranscript, onDraft }; }, [onTranscript, onDraft]);
  useEffect(() => () => { captureRef.current?.cancel(false); }, []);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const startListening = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) { setError('Speech recognition is not supported in this browser.'); return; }
    captureRef.current?.cancel(false);
    setError(null); setInterim('');
    const capture = new VoiceCapture(() => new SR(), {
      final: text => callbacks.current.onTranscript(text),
      draft: text => { setInterim(text); callbacks.current.onDraft?.(text); },
      listening: value => { setListening(value); if (!value) setInterim(''); },
      error: setError,
    });
    captureRef.current = capture; capture.start();
  }, []);
  const stopListening = useCallback(() => captureRef.current?.stop(), []);
  const cancelListening = useCallback((preserveDraft = true) => captureRef.current?.cancel(preserveDraft), []);

  const synth = useMemo(() => {
    const g = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : undefined;
    if (!g) return null;
    const s = (g as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    return typeof s === 'object' && s !== null ? (s as SpeechSynthesis) : null;
  }, []);

  const speak = useCallback((text: string) => {
    if (!synth) {
      setError('Speech synthesis is not supported in this browser.');
      return;
    }
    if (!text.trim()) {
      setError('There is no reply text to read aloud.');
      return;
    }
    setError(null);
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.05;
    utterance.pitch = 1;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = (event) => {
      setSpeaking(false);
      if (event.error !== 'canceled' && event.error !== 'interrupted') setError('Read aloud is unavailable. You can still read Ally’s reply above.');
    };
    utteranceRef.current = utterance;
    synth.speak(utterance);
  }, [synth]);

  const stopSpeaking = useCallback(() => {
    synth?.cancel();
    setSpeaking(false);
  }, [synth]);

  return { supported, playbackSupported: !!synth && typeof SpeechSynthesisUtterance === 'function', listening, speaking, interim, error, startListening, stopListening, cancelListening, speak, stopSpeaking };
}
