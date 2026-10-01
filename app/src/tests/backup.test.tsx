/**
 * Backup page tests — mock adapter (VITE_HERMES_LIVE=0). The page lists
 * removable media from the adapter, prompts for insertion when none is
 * detected, and runs a backup job to completion (mock completes in ~600ms;
 * the page polls status every 1s).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Backup from '../pages/Backup';
import { startRuntime } from '../state/runtime';
import { hermes as adapter } from '../adapters';

const mock = adapter as unknown as {
  __stopEvents(): void;
  __setBackupMedia(media: { path: string; label: string; removable: boolean; availableBytes?: number; sizeBytes?: number }[]): void;
};

const MOCK_USB = { path: '/media/mock-usb', label: 'MOCK-USB', removable: true, availableBytes: 32_000_000_000, sizeBytes: 64_000_000_000 };

beforeAll(() => {
  startRuntime();
  mock.__stopEvents();
});

beforeEach(() => {
  mock.__setBackupMedia([MOCK_USB]);
});

describe('Backup page', () => {
  it('renders the header, the included-sources card, and detected media', async () => {
    render(<Backup />);
    expect(screen.getByRole('heading', { name: 'Backup' })).toBeTruthy();
    expect(screen.getByText('What gets backed up')).toBeTruthy();
    expect(screen.getByText(/Ollama model weights are not included/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('MOCK-USB')).toBeTruthy());
    expect(screen.getByText(/media\/mock-usb/)).toBeTruthy();
    expect(screen.getByText(/64\.0 GB total/)).toBeTruthy();
  });

  it('prompts for a USB drive when no removable media is detected', async () => {
    mock.__setBackupMedia([]);
    render(<Backup />);
    await waitFor(() => expect(screen.getByText('No removable media detected')).toBeTruthy());
    expect(screen.getByText(/Insert a USB drive and click Refresh/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Backup now' })).toBeNull();
  });

  it('runs a backup to completion and shows the archive details', async () => {
    const user = userEvent.setup();
    render(<Backup />);
    const start = await screen.findByRole('button', { name: 'Backup now' });
    await user.click(start);

    // Running state shows while the mock job packs
    await waitFor(() => expect(screen.getByText('Backup in progress…')).toBeTruthy());

    // Mock completes after ~600ms; the page polls every 1s
    await waitFor(() => expect(screen.getByText('Last backup')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByText(/media\/mock-usb\/eaios-backup-mock\.tar\.gz/)).toBeTruthy();
    expect(screen.getByText('1.2 MB')).toBeTruthy();
  });
});
