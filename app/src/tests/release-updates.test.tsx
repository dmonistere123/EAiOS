import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReleaseUpdates } from '../components/ReleaseUpdates';
import { hermes } from '../adapters';
import type { ReleaseUpdateInfo } from '../domain/types';

const initial: ReleaseUpdateInfo = { repository: 'dmonistere123/EAiOS', checkIntervalDays: 7, status: 'not_checked' };
const available: ReleaseUpdateInfo = { ...initial, status: 'available', lastCheckedAt: '2026-09-16T12:00:00Z', lastSuccessfulCheckAt: '2026-09-16T12:00:00Z',
  release: { id: 42, tag: 'v0.2.0', version: '0.2.0', name: 'EAiOS 0.2.0', notes: '<script>Example notes are plain text</script>', url: 'https://github.com/dmonistere123/EAiOS/releases/tag/v0.2.0' } };
afterEach(() => vi.restoreAllMocks());
describe('release updates', () => {
  it('loads cached status without checking GitHub, and checks only when requested', async () => {
    vi.spyOn(hermes, 'getReleaseUpdateInfo').mockResolvedValue(initial);
    const check = vi.spyOn(hermes, 'checkForUpdates').mockResolvedValue(available);
    const install = vi.spyOn(hermes, 'installReleaseUpdate');
    render(<ReleaseUpdates />);
    expect(await screen.findByText('Not checked yet')).toBeInTheDocument(); expect(check).not.toHaveBeenCalled(); expect(install).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Update available')).toBeInTheDocument(); expect(check).toHaveBeenCalledOnce(); expect(install).not.toHaveBeenCalled();
    expect(screen.getByText(/Checks GitHub weekly/)).toBeInTheDocument();
  });
  it('requires a separate deliberate installation action and displays failures', async () => {
    vi.spyOn(hermes, 'getReleaseUpdateInfo').mockResolvedValue(available);
    const install = vi.spyOn(hermes, 'installReleaseUpdate').mockResolvedValue({ ok: false, auditEventId: 'failed', error: { code: 'busy', safeMessage: 'Work is active', retryable: true } });
    render(<ReleaseUpdates />); await screen.findByText('Update available');
    await userEvent.click(screen.getByRole('button', { name: 'Install update' })); expect(install).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Install 0.2.0' }));
    expect(await screen.findByText('Work is active')).toBeInTheDocument(); expect(install).toHaveBeenCalledWith(42);
  });
  it('shows failed checks and retains the last successful check without offering installation', async () => {
    vi.spyOn(hermes, 'getReleaseUpdateInfo').mockResolvedValue({ ...available, status: 'check_failed', error: 'Network unavailable' });
    render(<ReleaseUpdates />); expect(await screen.findByText('Check failed')).toBeInTheDocument();
    expect(screen.getByText(/Last successful check/)).toBeInTheDocument(); expect(screen.getByText('Network unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install update' })).not.toBeInTheDocument();
  });
  it('distinguishes no published releases from up-to-date and safely renders notes', async () => {
    vi.spyOn(hermes, 'getReleaseUpdateInfo').mockResolvedValue({ ...initial, status: 'no_releases' });
    const check = vi.spyOn(hermes, 'checkForUpdates').mockResolvedValue(available);
    render(<ReleaseUpdates />); expect(await screen.findByText('No releases published')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' })); await screen.findByText('Update available');
    expect(screen.getByText('<script>Example notes are plain text</script>')).toBeInTheDocument(); expect(document.querySelector('script')).toBeNull(); expect(check).toHaveBeenCalledOnce();
  });
});
