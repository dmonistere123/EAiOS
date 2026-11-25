export function isAudioArtifact(mime: string, name: string) {
  return mime.toLowerCase().startsWith('audio/') || ((!mime || mime === 'application/octet-stream') && /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(name));
}
/** One audible player at a time, including the existing podcast player. */
export function pauseOtherAudio(active: HTMLAudioElement) {
  document.querySelectorAll('audio').forEach(audio => { if (audio !== active && !audio.paused) audio.pause(); });
}
