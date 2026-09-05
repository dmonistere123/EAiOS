/**
 * Travel page tests (F31) — renders top cards, shows upcoming trips,
 * opens search drawer, trip drawer with tabs, and create-trip flow.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Travel from '../pages/Travel';
import { startRuntime, getState } from '../state/runtime';
import { hermes } from '../adapters';

beforeAll(async () => {
  startRuntime();
  (hermes as unknown as { __stopEvents(): void }).__stopEvents();
  // Wait for the runtime to hydrate
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (!getState().ready) {
    await new Promise((r) => setTimeout(r, 50));
  }
});

function setup() {
  return render(
    <MemoryRouter>
      <Travel />
    </MemoryRouter>,
  );
}

describe('Travel page', () => {
  it('renders the title and description', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: /Travel/i })).toBeInTheDocument();
    expect(screen.getByText(/Flights, hotels, cars, and restaurants/i)).toBeInTheDocument();
  });

  it('shows three top action cards', async () => {
    setup();
    expect(await screen.findByText('Flights')).toBeInTheDocument();
    expect(screen.getByText('Hotels & Cars')).toBeInTheDocument();
    expect(screen.getByText('Restaurants')).toBeInTheDocument();
  });

  it('shows upcoming trips from mock fixtures', async () => {
    setup();
    expect(await screen.findByText('Baton Rouge quarterly visit')).toBeInTheDocument();
    expect(screen.getByText('Investor dinner — NYC')).toBeInTheDocument();
  });

  it('opens a flight search drawer when Flights card is clicked', async () => {
    setup();
    const flightsCard = await screen.findByText('Flights');
    await userEvent.click(flightsCard);
    expect(await screen.findByRole('dialog', { name: /Search flights/i })).toBeInTheDocument();
    expect(screen.getByText('Origin (airport/city)')).toBeInTheDocument();
    expect(screen.getByText('Destination (airport/city)')).toBeInTheDocument();
  });

  it('opens trip drawer on clicking a trip and shows itinerary tab', async () => {
    setup();
    const tripButton = await screen.findByText('Baton Rouge quarterly visit');
    await userEvent.click(tripButton);
    expect(await screen.findByRole('dialog', { name: /Baton Rouge quarterly visit/i })).toBeInTheDocument();
    // Should show confirmed flight and hotel
    expect(screen.getByText(/DL1456/)).toBeInTheDocument();
    expect(screen.getByText(/Watermark Hotel/)).toBeInTheDocument();
    // Tab buttons
    expect(screen.getByText('itinerary (3)')).toBeInTheDocument();
    expect(screen.getByText('confirmations (2)')).toBeInTheDocument();
    expect(screen.getByText('approvals (1)')).toBeInTheDocument();
  });

  it('switches to approvals tab and shows pending approval', async () => {
      setup();
      const tripButton = await screen.findByText('Baton Rouge quarterly visit');
      await userEvent.click(tripButton);
      const approvalsTab = await screen.findByText('approvals (1)');
      await userEvent.click(approvalsTab);
      const results = await screen.findAllByText(/Enterprise Midsize/);
      expect(results.length).toBeGreaterThanOrEqual(1);
      // Approve/reject buttons
      expect(screen.getByText('Approve')).toBeInTheDocument();
      expect(screen.getByText('Reject')).toBeInTheDocument();
    });

  it('opens new trip drawer', async () => {
    setup();
    const newTripBtn = await screen.findByText('New trip');
    await userEvent.click(newTripBtn);
    expect(await screen.findByRole('dialog', { name: /New trip/i })).toBeInTheDocument();
  });

  it('uses Ask Ally to search flights by natural language', async () => {
    setup();
    const input = await screen.findByPlaceholderText(/Try "flights BHM to BTR Sep 15–17"/i);
    await userEvent.type(input, 'flights BHM to BTR');
    const searchBtn = screen.getByRole('button', { name: 'Search' });
    await userEvent.click(searchBtn);
    expect(await screen.findByText(/Found \d+ flight/i)).toBeInTheDocument();
  });
});