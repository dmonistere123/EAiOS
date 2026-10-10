import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { ApiKeysPanel } from '../components/ApiKeysPanel';
import { apiKeys } from '../adapters';
vi.mock('../adapters', () => ({ adapterMode: 'live', apiKeys: { list: vi.fn(), save: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const listing = { scope: 'app', version: 'before', keys: [{ key: 'DUFFEL_API_KEY', name: 'Duffel', description: 'Travel', configured: true, source: 'saved', mode: 'test' }] };
it('keeps saved keys hidden, submits only typed replacement, and clears it after saving', async () => {
  vi.mocked(apiKeys.list).mockResolvedValue(listing as never);
  vi.mocked(apiKeys.save).mockResolvedValue(undefined);
  render(<ApiKeysPanel />);
  const input = await screen.findByLabelText('Duffel');
  expect(input).toHaveAttribute('type', 'password'); expect(input).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Save key' })).toBeDisabled();
  fireEvent.change(input, { target: { value: 'duffel_live_fixture' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
  await waitFor(() => expect(apiKeys.save).toHaveBeenCalledWith('app', 'DUFFEL_API_KEY', 'duffel_live_fixture', 'before'));
  await waitFor(() => expect(input).toHaveValue(''));
  expect(await screen.findByRole('status')).toHaveTextContent('Provider access has not been tested');
});
it('does not claim success on failure and discards drafts when switching sections', async () => {
  vi.mocked(apiKeys.list).mockImplementation(async scope => ({ ...listing, scope } as never));
  vi.mocked(apiKeys.save).mockRejectedValue(new Error('Configuration changed. Reload settings.'));
  render(<ApiKeysPanel />);
  const input = await screen.findByLabelText('Duffel');
  fireEvent.change(input, { target: { value: 'unsaved' } }); fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Configuration changed');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Used by'), { target: { value: 'hermes' } });
  await waitFor(() => expect(screen.getByLabelText('Duffel')).toHaveValue(''));
});

it('a save finishing after a section change cannot replace the new section', async () => {
  let finish!: () => void;
  vi.mocked(apiKeys.save).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  vi.mocked(apiKeys.list).mockImplementation(async scope => ({ ...listing, scope, keys: scope === 'app' ? listing.keys : [{ ...listing.keys[0], key: 'OPENROUTER_API_KEY', name: 'OpenRouter' }] } as never));
  render(<ApiKeysPanel />);
  fireEvent.change(await screen.findByLabelText('Duffel'), { target: { value: 'fixture' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
  fireEvent.change(screen.getByLabelText('Used by'), { target: { value: 'hermes' } });
  expect(await screen.findByLabelText('OpenRouter')).toBeInTheDocument();
  await act(async () => { finish(); });
  expect(screen.getByLabelText('OpenRouter')).toBeInTheDocument();
  expect(screen.queryByLabelText('Duffel')).not.toBeInTheDocument();
});
