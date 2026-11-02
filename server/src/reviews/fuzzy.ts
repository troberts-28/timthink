export interface FuzzyMatch {
  start: number;
  end: number;
  errors: number;
}

// Sellers' approximate substring search with Ukkonen's cut-off, so typical input costs O(maxErrors · n).
export function fuzzySearch(
  text: string,
  pattern: string,
  maxErrors: number,
  from = 0,
  to = text.length,
): FuzzyMatch[] {
  const m = pattern.length;
  if (m === 0 || maxErrors < 0) return [];
  const tooFar = maxErrors + 1;
  let previous = new Int32Array(m + 1);
  let current = new Int32Array(m + 1);
  let previousStart = new Int32Array(m + 1);
  let currentStart = new Int32Array(m + 1);
  for (let row = 0; row <= m; row += 1) {
    previous[row] = Math.min(row, tooFar);
    previousStart[row] = from;
  }
  let lastActive = Math.min(maxErrors, m);
  const matches: FuzzyMatch[] = [];

  for (let column = from; column < to; column += 1) {
    const char = text.charCodeAt(column);
    current[0] = 0;
    currentStart[0] = column + 1;
    const limit = Math.min(m, lastActive + 1);
    for (let row = 1; row <= limit; row += 1) {
      const diagonal = (previous[row - 1] ?? tooFar) + (pattern.charCodeAt(row - 1) === char ? 0 : 1);
      const up = (current[row - 1] ?? tooFar) + 1;
      const left = (previous[row] ?? tooFar) + 1;
      if (diagonal <= up && diagonal <= left) {
        current[row] = diagonal;
        currentStart[row] = previousStart[row - 1] ?? column;
      } else if (up <= left) {
        current[row] = up;
        currentStart[row] = currentStart[row - 1] ?? column;
      } else {
        current[row] = left;
        currentStart[row] = previousStart[row] ?? column;
      }
    }
    for (let row = limit + 1; row <= m; row += 1) current[row] = tooFar;
    lastActive = limit;
    while (lastActive > 0 && (current[lastActive] ?? tooFar) > maxErrors) lastActive -= 1;
    if (lastActive === m) {
      matches.push({ start: currentStart[m] ?? column, end: column + 1, errors: current[m] ?? tooFar });
    }
    [previous, current] = [current, previous];
    [previousStart, currentStart] = [currentStart, previousStart];
  }
  return matches;
}
