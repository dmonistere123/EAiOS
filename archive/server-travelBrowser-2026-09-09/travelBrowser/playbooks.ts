/**
 * Per-site browser-automation playbooks for travel booking.
 *
 * A playbook describes how to search a consumer site and how to navigate to the
 * final review page for a selected result. The runner can execute steps
 * explicitly or hand the playbook to a browser-use Agent as a high-level task.
 *
 * v0 ships with a generic "kayak" playbook for hotels/cars and stub
 * registrations for IHG, Marriott, OpenTable, and Resy. Per-site hardening is
 * tracked in child kanban tasks.
 */

export type PlaybookKind = 'hotel' | 'car' | 'restaurant';

export type PlaybookStep =
  | { action: 'goto'; url: string }
  | { action: 'fill'; selector: string; value: string }
  | { action: 'click'; selector: string; stable?: boolean }
  | { action: 'wait'; ms: number }
  | { action: 'select'; selector: string; value: string }
  | { action: 'extract'; prompt: string; schema: Record<string, 'string' | 'number' | 'boolean'> }
  | { action: 'extract_list'; prompt: string; items: Record<string, 'string' | 'number' | 'boolean'> }
  | { action: 'screenshot' };

export interface Playbook {
  id: string;
  site: string;
  kind: PlaybookKind;
  displayName: string;
  loginUrl?: string;
  searchUrl: string;
  /** Steps to run when the saved session appears expired. */
  authSteps?: PlaybookStep[];
  /** Steps to perform a search and extract result cards. */
  searchSteps: PlaybookStep[];
  /** Steps to select a result and stop at the review page. */
  bookingSteps: PlaybookStep[];
}

// ---------- Kayak hotels / cars ----------

export const KAYAK_HOTELS: Playbook = {
  id: 'kayak-hotels',
  site: 'kayak',
  kind: 'hotel',
  displayName: 'Kayak / consumer hotel search',
  searchUrl: 'https://www.kayak.com/stays',
  searchSteps: [
    { action: 'goto', url: 'https://www.kayak.com/stays' },
    {
      action: 'extract',
      prompt: 'Search for hotels at the destination for the given dates. Return up to 5 hotels with name, nightly rate, total price, room type, and a short address.',
      schema: {
        title: 'string',
        subtitle: 'string',
        priceUsd: 'number',
        hotelName: 'string',
        roomType: 'string',
        address: 'string',
        checkIn: 'string',
        checkOut: 'string',
      },
    },
  ],
  bookingSteps: [
    {
      action: 'extract',
      prompt: 'Select the requested hotel/room and proceed to the review/booking page. Stop before clicking any final "Book", "Pay", or "Complete reservation" button. Return the final review page URL, total price, and any confirmation or reference number visible.',
      schema: {
        finalUrl: 'string',
        priceUsd: 'number',
        confirmationNumber: 'string',
      },
    },
  ],
};

export const KAYAK_CARS: Playbook = {
  id: 'kayak-cars',
  site: 'kayak',
  kind: 'car',
  displayName: 'Kayak / consumer car rental search',
  searchUrl: 'https://www.kayak.com/cars',
  searchSteps: [
    { action: 'goto', url: 'https://www.kayak.com/cars' },
    {
      action: 'extract',
      prompt: 'Search for rental cars at the pickup location for the given dates. Return up to 5 options with company, car type, pickup/dropoff location, total price, and any cancellation note.',
      schema: {
        title: 'string',
        subtitle: 'string',
        priceUsd: 'number',
        company: 'string',
        carType: 'string',
        pickupLocation: 'string',
        dropoffLocation: 'string',
        pickupAt: 'string',
        dropoffAt: 'string',
      },
    },
  ],
  bookingSteps: [
    {
      action: 'extract',
      prompt: 'Select the requested car rental option and proceed to the review/reservation page. Stop before clicking any final "Reserve", "Pay", or "Book" button. Return the final review page URL and total price.',
      schema: {
        finalUrl: 'string',
        priceUsd: 'number',
        confirmationNumber: 'string',
      },
    },
  ],
};

// ---------- Restaurant playbooks ----------

export const OPENTABLE_RESTAURANTS: Playbook = {
  id: 'opentable-restaurants',
  site: 'opentable',
  kind: 'restaurant',
  displayName: 'OpenTable restaurant reservations',
  loginUrl: 'https://www.opentable.com/signin',
  searchUrl: 'https://www.opentable.com/s/',
  authSteps: [
    { action: 'goto', url: 'https://www.opentable.com/signin' },
    { action: 'fill', selector: 'input[type="email"], input[name="email"], input#email', value: '<username>' },
    { action: 'fill', selector: 'input[type="password"], input[name="password"], input#password', value: '<password>' },
    { action: 'click', selector: 'button[type="submit"], [data-test="signin-button"], button:contains("Sign in")', stable: true },
    { action: 'wait', ms: 4000 },
  ],
  searchSteps: [
    { action: 'goto', url: 'https://www.opentable.com/s/?term=<destination>&date=<date>&time=19:00&partySize=<partySize>' },
    { action: 'wait', ms: 3000 },
    {
      action: 'extract',
      prompt: 'You are on the OpenTable search results page. For each restaurant card showing availability for the requested date and party size, return: the restaurant name, cuisine type, address, one available reservation time as a local ISO 8601 datetime (YYYY-MM-DDTHH:MM:SS), party size, and the restaurant reservation page URL (the link to go to the restaurant to book). Return up to 5 results.',
      schema: {
        title: 'string',
        subtitle: 'string',
        restaurantName: 'string',
        cuisine: 'string',
        address: 'string',
        reservationAt: 'string',
        partySize: 'number',
        externalUrl: 'string',
      },
    },
  ],
  bookingSteps: [
    { action: 'goto', url: '<externalUrl>' },
    { action: 'wait', ms: 3000 },
    {
      action: 'extract',
      prompt: 'You are booking a table at this OpenTable restaurant. The requested reservation is on <date> for <partySize> people. Look at the available times and select a time that matches or is close to <result.reservationAt>. Proceed through to the reservation review page. Do NOT click any final "Confirm reservation", "Complete reservation", or "Book" button. Stop at the review page. Return the review page URL, the final reservation datetime (ISO 8601), party size, and any confirmation or reference number already visible.',
      schema: {
        finalUrl: 'string',
        reservationAt: 'string',
        partySize: 'number',
        confirmationNumber: 'string',
      },
    },
  ],
};

export const RESY_RESTAURANTS: Playbook = {
  id: 'resy-restaurants',
  site: 'resy',
  kind: 'restaurant',
  displayName: 'Resy restaurant reservations',
  loginUrl: 'https://resy.com/',
  searchUrl: 'https://resy.com/cities/{citySlug}?date={searchDate}&seats={partySize}',
  authSteps: [
    { action: 'goto', url: 'https://resy.com/' },
    { action: 'wait', ms: 2000 },
    // Resy login is a modal triggered by the top-right "Log in" link/button.
    { action: 'click', selector: 'a[href="#"], button:has-text("Log in"), [data-test="login-button"], nav a:has-text("Log in")', stable: true },
    { action: 'wait', ms: 1500 },
    { action: 'fill', selector: 'input[name="email"], input[type="email"], input#email', value: '<username>' },
    { action: 'fill', selector: 'input[name="password"], input[type="password"]', value: '<password>' },
    { action: 'click', selector: 'button[type="submit"]', stable: true },
    { action: 'wait', ms: 3000 },
  ],
  searchSteps: [
    { action: 'goto', url: 'https://resy.com/cities/{citySlug}?date={searchDate}&seats={partySize}' },
    { action: 'wait', ms: 3000 },
    {
      action: 'extract',
      prompt: 'You are on the Resy city page for the destination. The reservation date is the given date and the party size is the given size.\n'
        + '1. Scroll down to see available restaurants. Look for restaurant cards showing: name, cuisine type, price range ($/$$/$$$/$$$$), rating, neighborhood, and available reservation times.\n'
        + '2. For each restaurant card, extract: the restaurant name, cuisine, neighborhood/address, one available reservation time (as ISO 8601, e.g. YYYY-MM-DDTHH:MM:SS), the party size, and the venue URL slug from the card link (typically /venues/<venue-slug>).\n'
        + '3. Build the externalUrl using the venue slug: https://resy.com/cities/{citySlug}/venues/<venue-slug>?date={searchDate}&seats={partySize}\n'
        + '4. Return up to 10 results.',
      schema: {
        title: 'string',
        subtitle: 'string',
        priceUsd: 'number',
        restaurantName: 'string',
        cuisine: 'string',
        address: 'string',
        reservationAt: 'string',
        partySize: 'number',
        venueSlug: 'string',
        externalUrl: 'string',
      },
    },
  ],
  bookingSteps: [
    { action: 'goto', url: 'https://resy.com/cities/{citySlug}/venues/{venueSlug}?date={searchDate}&seats={partySize}' },
    { action: 'wait', ms: 3000 },
    {
      action: 'extract',
      prompt: 'You are on a Resy restaurant venue page. The party size is the given size and the date is the given date.\n'
        + '1. Look for available time slots for the given date and party size. They are typically shown as a list or grid of times like "7:00 PM" with the table type/area.\n'
        + '2. Click on one available time slot that is reasonable for dinner (between 5:00 PM and 9:00 PM if multiple options exist).\n'
        + '3. Wait for the reservation review/preview panel to appear.\n'
        + '4. STOP here. Do NOT click any final "Confirm", "Book", "Complete reservation", "Reserve", or "Pay" button.\n'
        + '5. Return the current page URL (the review page), the selected reservation datetime (ISO 8601), party size, and any confirmation or booking token visible on the page.',
      schema: {
        finalUrl: 'string',
        reservationAt: 'string',
        partySize: 'number',
        confirmationNumber: 'string',
      },
    },
  ],
};

// ---------- Hotel chain playbooks ----------

export const MARRIOTT_HOTELS: Playbook = {
  id: 'marriott-hotels',
  site: 'marriott',
  kind: 'hotel',
  displayName: 'Marriott Bonvoy',
  loginUrl: 'https://www.marriott.com/sign-in.mi',
  searchUrl: 'https://www.marriott.com/search/default.mi',
  authSteps: [
    { action: 'goto', url: 'https://www.marriott.com/sign-in.mi' },
    { action: 'fill', selector: 'input#email, input[name="email"], input[type="email"]', value: '<username>' },
    { action: 'fill', selector: 'input#password, input[name="password"], input[type="password"]', value: '<password>' },
    { action: 'click', selector: 'button[data-testid="sign-in-button"], button[type="submit"]', stable: true },
    { action: 'wait', ms: 5000 },
  ],
  searchSteps: [
    { action: 'goto', url: 'https://www.marriott.com/search/default.mi' },
    {
      action: 'extract',
      prompt: 'You are searching Marriott.com for hotels.\n'
        + '1. After the page loads, check if there is a destination/city input field. Enter the destination: "<destination>".\n'
        + '2. Enter the check-in date "<checkIn>" (use format MM/DD/YYYY).\n'
        + '3. Enter the check-out date "<checkOut>" (use format MM/DD/YYYY).\n'
        + '4. Click the "Find Hotels" or "Search" button.\n'
        + '5. Wait for the search results page to load fully.\n'
        + '6. Find up to 5 hotel listings. For each, extract: hotel name, room type/name, nightly rate, total price for the stay, full address, and the hotel detail page URL (externalUrl).\n'
        + '\n'
        + 'Return ONLY a JSON object with a "results" array matching this schema.',
      schema: {
        title: 'string',
        subtitle: 'string',
        priceUsd: 'number',
        hotelName: 'string',
        roomType: 'string',
        address: 'string',
        externalUrl: 'string',
        checkIn: 'string',
        checkOut: 'string',
      },
    },
  ],
  bookingSteps: [
    {
      action: 'extract',
      prompt: 'The selected option is described above. Navigate to the selected hotel\'s detail page (use its externalUrl if available on the search results).\n'
        + 'Find the exact room type mentioned above and proceed through the selection until you reach the reservation review page.\n'
        + 'STOP before clicking any final "Book", "Pay", "Complete Booking", or "Confirm" button.\n'
        + 'Return the final review page URL (finalUrl), the displayed total price (priceUsd), and any confirmation or reference number (confirmationNumber).',
      schema: {
        finalUrl: 'string',
        priceUsd: 'number',
        confirmationNumber: 'string',
      },
    },
  ],
};

export const IHG_HOTELS: Playbook = {
  id: 'ihg-hotels',
  site: 'ihg',
  kind: 'hotel',
  displayName: 'IHG Hotels & Resorts',
  loginUrl: 'https://www.ihg.com/rewardsclub/gb/en/login',
  searchUrl: 'https://www.ihg.com/hotels/us/en/reservation',
  authSteps: [
    { action: 'goto', url: 'https://www.ihg.com/rewardsclub/gb/en/login' },
    { action: 'fill', selector: 'input[name="email"], input#email, input[type="email"]', value: '<username>' },
    { action: 'fill', selector: 'input[name="password"], input#password, input[type="password"]', value: '<password>' },
    { action: 'click', selector: 'button[type="submit"], button.sign-in', stable: true },
    { action: 'wait', ms: 3000 },
  ],
  searchSteps: [
    {
      action: 'extract_list',
      prompt: 'Search IHG for hotels in "<destination>" from <checkIn> to <checkOut>. After results load, list each hotel card. Return up to 5 hotels.',
      items: {
        hotelName: 'string',
        roomType: 'string',
        priceUsd: 'number',
        address: 'string',
        checkIn: 'string',
        checkOut: 'string',
        externalUrl: 'string',
      },
    },
  ],
  bookingSteps: [
    {
      action: 'extract',
      prompt: 'Select the requested IHG hotel and room, proceed to the review/booking page, and stop before clicking any final "Book" or "Pay" button. Return the review page URL and total price.',
      schema: {
        finalUrl: 'string',
        priceUsd: 'number',
        confirmationNumber: 'string',
      },
    },
  ],
};

const REGISTRY: Playbook[] = [
  KAYAK_HOTELS,
  KAYAK_CARS,
  OPENTABLE_RESTAURANTS,
  RESY_RESTAURANTS,
  IHG_HOTELS,
  MARRIOTT_HOTELS,
];

/**
 * Human-readable city name → Resy city slug.
 * Resy uses hyphenated lower-case slugs (e.g. "new-york-ny", "los-angeles-ca").
 * Falls back to a heuristic for unrecognized cities.
 */
export function resyCitySlug(city: string): string {
  const map: Record<string, string> = {
    'new york': 'new-york-ny',
    nyc: 'new-york-ny',
    'new york city': 'new-york-ny',
    'los angeles': 'los-angeles-ca',
    chicago: 'chicago-il',
    'new orleans': 'new-orleans-la',
    nola: 'new-orleans-la',
    'san francisco': 'san-francisco-ca',
    'washington dc': 'washington-dc',
    'las vegas': 'las-vegas-nv',
    barcelona: 'barcelona',
    madrid: 'madrid',
    'hong kong': 'hong-kong',
  };
  const trimmed = city.trim().toLowerCase();
  if (map[trimmed]) return map[trimmed];
  // fallback: hyphenate
  return trimmed.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export function listPlaybooks(): Playbook[] {
  return REGISTRY.map((p) => ({ ...p }));
}

export function getPlaybook(id: string): Playbook | undefined {
  return REGISTRY.find((p) => p.id === id);
}

export function pickPlaybook(kind: PlaybookKind, preferredSite?: string): Playbook | undefined {
  if (preferredSite) {
    const exact = REGISTRY.find((p) => p.site === preferredSite && p.kind === kind);
    if (exact) return exact;
  }
  // Default: first playbook for the kind (Kayak for hotels/cars, OpenTable for restaurants).
  return REGISTRY.find((p) => p.kind === kind);
}