import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ArtifactAudio } from '../components/ArtifactAudio';
import { isAudioArtifact } from '../state/audioPlayback';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('artifact audio', () => {
 it.each(['mp3','m4a','aac','wav','ogg','opus','flac'])('recognizes %s with absent or generic MIME', ext => {
  expect(isAudioArtifact('', 'prayer.'+ext)).toBe(true);
  expect(isAudioArtifact('application/octet-stream', 'prayer.'+ext.toUpperCase())).toBe(true);
  expect(isAudioArtifact('text/plain', 'prayer.'+ext)).toBe(false);
 });
 it('uses same-origin media with native seek/play controls, no autoplay or eager download', () => {
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  render(<ArtifactAudio id="att-4" name="Prayer.mp3" available />);
  const player=screen.getByLabelText('Play Prayer.mp3') as HTMLAudioElement;
  expect(player.getAttribute('src')).toBe('/api/artifacts/att-4/raw');expect(player.controls).toBe(true);expect(player.autoplay).toBe(false);expect(player.preload).toBe('none');
  fireEvent.error(player);expect(screen.getByRole('status').textContent).toContain('could not be played');
 });
 it('pauses another playing audio and stops on unmount', () => {
  const pause=vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  const {unmount}=render(<><ArtifactAudio id="a" name="First" available/><ArtifactAudio id="b" name="Second" available/></>);
  const first=screen.getByLabelText('Play First'),second=screen.getByLabelText('Play Second');
  Object.defineProperty(first,'paused',{value:false,configurable:true});fireEvent.play(second);expect(pause).toHaveBeenCalledTimes(1);unmount();expect(pause).toHaveBeenCalledTimes(3);
 });
 it('does not request live files in mock mode and detects common audio types', () => {
  render(<ArtifactAudio id="a" name="Prayer.mp3" available={false}/>);expect(document.querySelector('audio')).toBeNull();expect(screen.getByText(/requires the live artifact store/)).toBeTruthy();
  expect(isAudioArtifact('audio/mpeg','prayer')).toBe(true);expect(isAudioArtifact('application/octet-stream','Prayer.MP3')).toBe(true);expect(isAudioArtifact('text/html','fake.mp3')).toBe(false);
 });
});
