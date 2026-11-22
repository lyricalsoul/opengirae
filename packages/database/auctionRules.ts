// pure auction rules with no db imports, so the mini app's browser bundle can import them too (the site used to keep its own copy of this math, which drifted from placeBid once already).

export const ANTI_SNIPE_WINDOW_MS = 2 * 60 * 1000; // last 2min of the current expiresAt

export type MinimumBidInput = {
  currentBid: number | null;
  startingBid: number;
  bidIncrement: number;
  overtimeIncrement: number;
  capPrice: number;
  expiresAt: Date;
};

// shared by /lance, placeBid and the site's "lance mínimo" button, so all three suggest exactly what placeBid will accept.
export function computeMinimumBid(auction: MinimumBidInput, now: Date = new Date()): number {
  const inOvertime = auction.expiresAt.getTime() - now.getTime() < ANTI_SNIPE_WINDOW_MS;
  if (auction.currentBid === null) return auction.startingBid;
  // clamped to the cap: a raise step that overshoots it would otherwise make the cap itself unbiddable
  return Math.min(auction.currentBid + (inOvertime ? auction.overtimeIncrement : auction.bidIncrement), auction.capPrice);
}
