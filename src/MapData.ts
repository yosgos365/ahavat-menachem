export type SeatConfig = { id: string; row: number; col: number; label: string };

const createTable = (
  letter: string,
  startRow: number,
  startCol: number,
  width: number,
  height: number
): SeatConfig[] => {
  const seats: SeatConfig[] = [];
  let currentNum = 1;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      seats.push({
        id: `${letter}${currentNum}`,
        label: `${letter}${currentNum}`,
        row: startRow + r,
        col: startCol + c,
      });
      currentNum++;
    }
  }
  return seats;
};

export const SEATS: SeatConfig[] = [
  // Row 1 (Men) - array row 2, height 2
  ...createTable('A', 2, 2, 3, 2),
  ...createTable('B', 2, 7, 3, 2),
  // Missing T3 (13) for Ark/Bima
  ...createTable('C', 2, 19, 3, 2),
  ...createTable('D', 2, 25, 3, 2),
  ...createTable('E', 2, 30, 3, 2),

  // Row 2 (Men) - array row 5, height 2
  ...createTable('F', 5, 2, 3, 2),
  ...createTable('G', 5, 7, 3, 2),
  // Missing T3 (13) for Bima
  ...createTable('H', 5, 19, 3, 2),
  ...createTable('I', 5, 25, 3, 2),
  ...createTable('J', 5, 30, 3, 2),

  // Row 3 (Men) - array row 8, height 1
  ...createTable('K', 8, 2, 3, 1),
  ...createTable('L', 8, 7, 3, 1),
  ...createTable('M', 8, 13, 3, 1), // Under Bima
  ...createTable('N', 8, 19, 3, 1),
  ...createTable('O', 8, 25, 3, 1),
  ...createTable('P', 8, 30, 3, 1),

  // Row 4 (Men) - array row 10, height 2
  ...createTable('Q', 10, 2, 3, 2),
  ...createTable('R', 10, 7, 3, 2),
  ...createTable('S', 10, 13, 3, 2),
  ...createTable('T', 10, 19, 3, 2),
  ...createTable('U', 10, 25, 3, 2),
  ...createTable('V', 10, 30, 3, 2),

  // Two single side seats shown separately on the synagogue reference plan.
  { id: 'X1', label: 'X1', row: 7, col: 0 },
  { id: 'X2', label: 'X2', row: 9, col: 0 },

  // Women's Section - 8 tables per row, width 3, height 1
  // Row 1 Women (array row 14)
  ...createTable('WA', 14, 2, 3, 1),
  ...createTable('WB', 14, 6, 3, 1),
  ...createTable('WC', 14, 10, 3, 1),
  ...createTable('WD', 14, 14, 3, 1),
  ...createTable('WE', 14, 18, 3, 1),
  ...createTable('WF', 14, 22, 3, 1),
  ...createTable('WG', 14, 26, 3, 1),
  ...createTable('WH', 14, 30, 3, 1),

  // Row 2 Women (array row 16)
  ...createTable('WI', 16, 2, 3, 1),
  ...createTable('WJ', 16, 6, 3, 1),
  ...createTable('WK', 16, 10, 3, 1),
  ...createTable('WL', 16, 14, 3, 1),
  ...createTable('WM', 16, 18, 3, 1),
  ...createTable('WN', 16, 22, 3, 1),
  ...createTable('WO', 16, 26, 3, 1),
  ...createTable('WP', 16, 30, 3, 1),
];

export const MAX_ROWS = 18;
export const MAX_COLS = 34;
