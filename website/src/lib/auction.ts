import { computeMinimumBid, type MinimumBidInput } from '@girae/database/auctionRules';

// dates arrive as ISO strings over the wire even though AuctionsDB's own types say Date.
export type AuctionListItem = {
	auction: { id: number; startingBid: number; currentBid: number | null; expiresAt: string; status?: string };
	cardName: string;
	cardImageUrl: string | null;
	rarityEmoji: string;
};

export const AUCTION_STATUS_LABEL: Record<string, string> = {
	active: 'Ativo',
	sold: 'Vendido',
	expired: 'Expirado',
	cancelled: 'Cancelado',
};

export function formatTimeLeft(expiresAt: string, now: number): string {
	const ms = new Date(expiresAt).getTime() - now;
	if (ms <= 0) return 'Terminando...';
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	if (hours > 0) return `${hours}h ${minutes}min`;
	return `${minutes}min ${String(totalSeconds % 60).padStart(2, '0')}s`;
}

// the same function placeBid enforces, fed the wire shape (expiresAt as a string).
export function minimumBidFor(auction: Omit<MinimumBidInput, 'expiresAt'> & { expiresAt: string }, nowMs: number): number {
	return computeMinimumBid({ ...auction, expiresAt: new Date(auction.expiresAt) }, new Date(nowMs));
}
