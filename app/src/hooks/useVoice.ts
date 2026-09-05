/**
 * Browser Web Speech API wrapper for EAiOS voice I/O.
 * Provides speech-to-text (STT) input and text-to-speech (TTS) playback.
 * Falls back gracefully when the API is unavailable.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

export interface VoiceState {
  supported: boolean;
  listening: boolean;
  speaking: boolean;
  interim: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
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

export function useVoice(onTranscript: (text: string) => void): VoiceState {
  const [supported] = useState(() => {
    const SR = getSpeechRecognition();
    const g = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : undefined;
    const ss = !!g && typeof (g as unknown as { speechSynthesis?: unknown }).speechSynthesis === 'object' && (g as unknown as { speechSynthesis?: object }).speechSynthesis !== null;
    return !!SR || ss;
  });
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const startListening = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) {
      setError('Speech recognition is not supported in this browser.');
      return;
    }
    setError(null);
    setInterim('');
    try {
      const rec = new SR();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = 'en-US';
      let finalTranscript = '';
      const onResult = (event: SpeechRecognitionEvent) => {
        let currentInterim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            currentInterim += transcript;
          }
        }
        setInterim(currentInterim);
      };
      const onError = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'aborted' || event.error === 'no-speech') return;
        setError(`Speech error: ${event.error}`);
        setListening(false);
      };
      const onEnd = () => {
        setListening(false);
        setInterim('');
        if (finalTranscript) {
          onTranscript(finalTranscript.trim());
        }
      };
      rec.addEventListener('result', onResult as EventListener);
      rec.addEventListener('error', onError as EventListener);
      rec.addEventListener('end', onEnd as EventListener);
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch (e) {
      setError(`Could not start microphone: ${e instanceof Error ? e.message : String(e)}`);
      setListening(false);
    }
  }, [onTranscript]);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    setListening(false);
  }, []);

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
    setError(null);
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.05;
    utterance.pitch = 1;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    utteranceRef.current = utterance;
    synth.speak(utterance);
  }, [synth]);

  const stopSpeaking = useCallback(() => {
    synth?.cancel();
    setSpeaking(false);
  }, [synth]);

  return { supported, listening, speaking, interim, error, startListening, stopListening, speak, stopSpeaking };
}
