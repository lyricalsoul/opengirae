-- bid rows that can never produce an outbid DM were left at notifiedAt IS NULL and rescanned every minute by listUnnotifiedBids
UPDATE "auction_bids" b SET "notifiedAt" = now()
WHERE b."notifiedAt" IS NULL
  AND (
    EXISTS (SELECT 1 FROM "auction_bids" b3 WHERE b3."auctionId" = b."auctionId" AND b3."bidderId" = b."bidderId" AND b3.id > b.id)
    OR (
      EXISTS (SELECT 1 FROM "auctions" a WHERE a.id = b."auctionId" AND a.status <> 'active')
      AND NOT EXISTS (SELECT 1 FROM "auction_bids" b2 WHERE b2."auctionId" = b."auctionId" AND b2.id > b.id AND b2."bidderId" <> b."bidderId")
    )
  );
