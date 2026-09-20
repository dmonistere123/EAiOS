# Travel provider access — September 20, 2026

## Duffel

The existing test token successfully searches flights and cars. A car search, refreshed quote, and one postpaid test booking completed with a provider reference. No live reservation was made. Stays returns HTTP 403 with the explicit message: “This feature is not enabled for your account.” Request Stays activation and confirmation of live Cars access at https://duffel.com/contact-us.

Suggested request (not sent):

> We are integrating EAiOS, an executive assistant application, with our existing Duffel account. Flights work in test mode, and we have successfully searched, quoted, and booked a postpaid car in test mode. Please enable Duffel Stays sandbox access and advise on the requirements for Stays and Cars in live mode. Our intended flow is search, compare up to three options, refresh pricing and terms, obtain explicit traveler approval, then submit a single booking and retain its reference. Stays currently returns HTTP 403: “This feature is not enabled for your account.”

Do not send an API token in the request. The signed-in account or organization identifier is sufficient to begin support review.

After activation, rerun Stays search against the requested destination and Duffel's documented test hotel coordinates. Verify quote conditions, booking confirmation, and uncertain-outcome handling before claiming hotel integration works. The Cars implementation initially offers **postpaid** rates only, because card-guarantee and prepaid-card flows need payment integration.

References: [Stays setup](https://duffel.com/docs/guides/getting-started-with-stays), [Cars setup](https://duffel.com/docs/guides/getting-started-with-cars), [Cars test scenarios](https://duffel.com/docs/guides/testing-your-cars-integration-with-duffel-test-drive).

## OpenTable

Required outcome: actual table availability and reservations inside EAiOS. Directory listings and external links do not satisfy this requirement. Apply at https://www.opentable.com/restaurant-solutions/api-partners/become-a-partner/ and request the availability/search and Online Booking (Consumer) APIs, plus sandbox credentials. Approval is controlled by OpenTable; a consumer login is not API access.

Suggested product description (not submitted):

> EAiOS is an executive assistant application with a guided travel planner. We want users to specify destination, date, party size, preferred dining time, cuisine and dietary preferences; compare up to three restaurants with available table times; and confirm a reservation directly within EAiOS. We need restaurant discovery, real-time availability, and consumer reservation creation and management APIs. We will display the required OpenTable terms before booking and retain provider confirmation and cancellation information. Please advise on partner eligibility, sandbox access, authentication, required scopes, and production review.

Complete the company, contact, website, and usage questions with actual business information. No application has been submitted by this development task.

After approval:

1. Confirm granted endpoints/scopes and server-side OAuth credentials using the approved contract.
2. Add dining date, time, party size and preferences to the guided flow; retrieve actual matching time slots and restaurant metadata.
3. Let the user select a restaurant/time, review applicable terms, then explicitly confirm. A selected recommendation alone is not a reservation.
4. Submit once with a durable local attempt and provider request identifier. Reconcile uncertain results before allowing another attempt. Save the confirmed reference, restaurant time zone, and cancellation information.
5. Test through OpenTable sandbox, then validate required branding/consent and production approval.

The current application continues to report that restaurant booking is unavailable; it does not show invented table times. An OpenTable API key alone does not activate a functioning integration.

References: [OpenTable API documentation](https://docs.opentable.com/), [partner application](https://www.opentable.com/restaurant-solutions/api-partners/become-a-partner/).

## Webhooks

A webhook receives provider events; it does not enable Stays or Cars access. EAiOS still uses the API for search, quotes, and booking. A later webhook receiver should verify signatures, separate test/live events, deduplicate deliveries, and match events to the saved attempt/quote before updating booking state. It needs a reachable HTTPS endpoint; the loopback development URL is not a webhook destination. No webhook or network exposure was configured by this task.

[Receiving Duffel webhooks](https://duffel.com/docs/guides/receiving-webhooks)
