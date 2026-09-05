/**
 * useVoice hook tests — browser Web Speech API wrapper.
 * Mocks SpeechRecognition + speechSynthesis and asserts STT/TTS behavior.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoice } from '../hooks/useVoice';

class MockSpeechRecognition extends EventTarget {
  continuous = false;
  interimResults = false;
  lang = '';
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
}

describe('useVoice', () => {
  let recognitionInstance: MockSpeechRecognition | null = null;

  function installVoiceStubs(supported: boolean) {
    recognitionInstance = null;
    if (supported) {
      Object.defineProperty(globalThis, 'SpeechRecognition', {
        value: vi.fn(function () {
          recognitionInstance = new MockSpeechRecognition();
          return recognitionInstance;
        }),
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'webkitSpeechRecognition', {
        value: vi.fn(function () {
          recognitionInstance = new MockSpeechRecognition();
          return recognitionInstance;
        }),
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'speechSynthesis', {
        value: {
          speak: vi.fn(),
          cancel: vi.fn(),
          getVoices: vi.fn(() => []),
          paused: false,
          pending: false,
          speaking: false,
          onvoiceschanged: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
        value: vi.fn(function (this: unknown, text: string) {
          (this as { text: string }).text = text;
        }),
        configurable: true,
        writable: true,
      });
    } else {
      Object.defineProperty(globalThis, 'SpeechRecognition', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'webkitSpeechRecognition', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'speechSynthesis', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    }
  }

  beforeEach(() => {
    installVoiceStubs(true);
  });

  afterEach(() => {
    installVoiceStubs(false);
  });

  function dispatchTranscript(text: string, isFinal = true) {
    const rec = recognitionInstance!;
    const result: unknown[] = [{ transcript: text, confidence: 0.9 }];
    Object.defineProperty(result, 'isFinal', { value: isFinal });
    const event = new Event('result');
    Object.defineProperty(event, 'resultIndex', { value: 0 });
    Object.defineProperty(event, 'results', { value: [result] });
    rec.dispatchEvent(event);
  }

  it('reports supported when APIs are present', () => {
    const { result } = renderHook(() => useVoice(() => undefined));
    expect(result.current.supported).toBe(true);
  });

  it('starts listening and delivers the final transcript once', async () => {
    const transcripts: string[] = [];
    const { result } = renderHook(() => useVoice((text) => transcripts.push(text)));

    act(() => result.current.startListening());
    expect(result.current.listening).toBe(true);
    expect(recognitionInstance).not.toBeNull();

    dispatchTranscript('hello world');
    expect(result.current.interim).toBe('');

    act(() => recognitionInstance!.dispatchEvent(new Event('end')));

    expect(transcripts).toEqual(['hello world']);
    expect(result.current.listening).toBe(false);
  });

  it('speaks text through speechSynthesis', () => {
    const { result } = renderHook(() => useVoice(() => undefined));
    act(() => result.current.speak('hello'));
    expect(globalThis.speechSynthesis.speak).toHaveBeenCalled();
  });

  it('reports unsupported when APIs are absent', () => {
    installVoiceStubs(false);
    const { result } = renderHook(() => useVoice(() => undefined));
    expect(result.current.supported).toBe(false);
  });
});
