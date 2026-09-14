/**
 * Podcasts page tests — main player, episode rail, generate flow with TTS
 * provider + voice preview.
 */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Podcasts from '../pages/Podcasts';
import { startRuntime, getState } from '../state/runtime';
import { podcasts } from '../adapters';

beforeAll(async () => {
  startRuntime();
  (podcasts as unknown as { __stopEvents?(): void }).__stopEvents?.();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (!getState().ready) {
    await new Promise((r) => setTimeout(r, 50));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup() {
  return render(
    <MemoryRouter>
      <Podcasts />
    </MemoryRouter>,
  );
}

describe('Podcasts page', () => {
  it('renders title and generate panel', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: /Podcasts/i })).toBeInTheDocument();
    expect(screen.getByText('Generate episode')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose document' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument();
  });

  it('lists episodes in the contextual rail and selecting one shows the player', async () => {
    setup();
    const episode = await screen.findByText('Economic Scenarios for Transformative AI (mock)');
    await userEvent.click(episode);
    expect(await screen.findByRole('button', { name: /Play|Pause/i })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeInTheDocument();
    expect(screen.getByText('Download MP3')).toBeInTheDocument();
    expect(screen.getByText('View transcript')).toBeInTheDocument();
  });

  it('selects TTS provider and voices', async () => {
    setup();
    await screen.findByText('Generate episode');
    const providerSelect = screen.getByRole('combobox', { name: 'TTS provider' });
    await userEvent.selectOptions(providerSelect, 'elevenlabs');

    const hostInput = screen.getByRole('textbox', { name: 'Host voice' });
    const guestInput = screen.getByRole('textbox', { name: 'Guest voice' });
    await userEvent.type(hostInput, 'Chris');
    await userEvent.type(guestInput, 'Jessica');
    expect(hostInput).toHaveValue('Chris');
    expect(guestInput).toHaveValue('Jessica');
  });

  it('previews a voice through the adapter', async () => {
    const spy = vi.spyOn(podcasts, 'sampleTts').mockResolvedValue(new Blob(['mp3'], { type: 'audio/mpeg' }));
    setup();
    await screen.findByText('Generate episode');

    const hostInput = screen.getByRole('textbox', { name: 'Host voice' });
    await userEvent.type(hostInput, 'Chris');
    const previewBtn = screen.getByRole('button', { name: /Preview host voice/i });
    await userEvent.click(previewBtn);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('edge', 'Chris'), { timeout: 2000 });
  });

  it('starts generation when a file is chosen and Generate is clicked', async () => {
    const spy = vi.spyOn(podcasts, 'uploadAndGenerate').mockResolvedValue({
      id: 'p-new',
      sourceName: 'uploaded.pdf',
      sourceType: 'file',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    setup();
    await screen.findByText('Generate episode');
    const fileInput = screen.getByLabelText('Document to convert');
    const file = new File(['pdf bytes'], 'uploaded.pdf', { type: 'application/pdf' });
    await userEvent.upload(fileInput, file);

    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(spy).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ provider: 'edge' }),
    );
  });
});