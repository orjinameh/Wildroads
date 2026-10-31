import { getStore } from "./store";
import type { CellsResult } from "./types";

export type { Cell, CellsResult } from "./types";

export async function loadCells(): Promise<CellsResult> {
  return (await getStore()).loadCells();
}
