/// Used for picking cards
export function pickWeighted<T>(items: T[], weightSelector: (item: T) => number): T | undefined {
  if (items.length === 0) return undefined;

  const totalWeight = items.reduce((sum, item) => sum + weightSelector(item), 0);
  // TODO: switch to crypto later
  let randomRoll = Math.random() * totalWeight;

  for (const item of items) {
    randomRoll -= weightSelector(item);
    if (randomRoll <= 0) {
      return item;
    }
  }

  console.log('RNG error: no items selected');
  return items[items.length - 1];
}

/// Used for picking subcategories mostly
export function pickMultipleWeighted<T>(
  items: T[], 
  count: number, 
  weightSelector: (item: T) => number
): T[] {
  const selected: T[] = [];
  const pool = [...items]; 

  for (let i = 0; i < count; i++) {
    const winner = pickWeighted(pool, weightSelector);
    if (!winner) break;
    
    selected.push(winner);

    const winnerIndex = pool.indexOf(winner);
    if (winnerIndex > -1) pool.splice(winnerIndex, 1);
  }

  return selected;
}