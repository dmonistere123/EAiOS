import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CronInspector } from '../pages/Schedule';
import { live } from '../adapters';
import type { CronJob } from '../domain/types';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const base: CronJob = { id: 'job', name: 'Investment Brief', scheduleExpression: '0 6 * * 1-5', nextRunAt: '2026-10-12T06:00:00Z', enabled: true, approvalPolicy: 'pre_approved' };
it('shows complete saved instructions when Hermes returns only prompt_preview', async () => {
  const prompt = 'Analyze investments.\n'.repeat(100) + 'Final instruction.';
  const holder = live as unknown as { rpc: { call: (...args: unknown[]) => Promise<unknown> } };
  const original = holder.rpc;
  holder.rpc = { call: vi.fn().mockResolvedValue({ jobs: [{ job_id: 'job', name: 'Investment Brief', prompt_preview: prompt.slice(0, 100) + '...' }], scoped: 'quill' }) };
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: [{ id: 'job', prompt }] }) }); vi.stubGlobal('fetch', fetcher);
  try {
    const [job] = await live.listCronJobs('quill');
    expect(fetcher).toHaveBeenCalledWith('/api/cron-prompts?profile=quill');
    expect(job.prompt).toBe(prompt);
    render(<CronInspector job={job} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByLabelText('What the job does (prompt)')).toHaveValue(prompt);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  } finally { holder.rpc = original; }
});
it('does not turn a preview into editable instructions on read failure', async () => {
  const holder = live as unknown as { rpc: { call: (...args: unknown[]) => Promise<unknown> } }; const original = holder.rpc;
  holder.rpc = { call: vi.fn().mockResolvedValue({ jobs: [{ job_id: 'job', prompt_preview: 'Truncated...' }] }) };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  try {
    const [job] = await live.listCronJobs(); expect(job.prompt).toBeUndefined();
    render(<CronInspector job={{ ...base, prompt: job.prompt }} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByLabelText('What the job does (prompt)')).toBeDisabled();
    expect(screen.getByPlaceholderText(/Full instructions could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  } finally { holder.rpc = original; }
});
it('distinguishes a genuinely empty saved prompt from a failed read', () => {
  render(<CronInspector job={{ ...base, prompt: '' }} onClose={() => {}} onChanged={() => {}} />);
  expect(screen.getByLabelText('What the job does (prompt)')).toBeEnabled();
  expect(screen.getByPlaceholderText('No text prompt saved for this job.')).toBeInTheDocument();
});
