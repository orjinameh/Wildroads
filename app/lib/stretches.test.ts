// Unit tests of the grouping maths with hand-made grid coordinates (not product data).
import test from "node:test";
import assert from "node:assert/strict";
import { groupCells, median } from "./stretches.ts";
import { roughnessLevel, speedLevel, rankPct, MIN_CELLS_TO_COMPARE } from "./level.ts";

test("a straight chain of touching cells is one stretch with n-1 links", () => {
  const g = groupCells([0, 1, 2, 3, 4].map((b) => ({ a: 10, b })));
  assert.equal(g.length, 1);
  assert.equal(g[0].members.length, 5);
  assert.equal(g[0].links.length, 4);
});

test("cells separated by a gap are separate stretches", () => {
  const g = groupCells([{ a: 0, b: 0 }, { a: 0, b: 1 }, { a: 0, b: 3 }, { a: 0, b: 4 }]);
  assert.equal(g.length, 2);
  assert.deepEqual(g.map((x) => x.members.length).sort(), [2, 2]);
});

test("diagonal neighbours join in both diagonal directions", () => {
  assert.equal(groupCells([{ a: 0, b: 0 }, { a: 1, b: 1 }, { a: 2, b: 2 }]).length, 1);
  assert.equal(groupCells([{ a: 0, b: 2 }, { a: 1, b: 1 }, { a: 2, b: 0 }]).length, 1);
});

test("an isolated cell is a stretch of one with no links", () => {
  const g = groupCells([{ a: 5, b: 5 }]);
  assert.equal(g.length, 1);
  assert.equal(g[0].links.length, 0);
});

test("a link is never listed twice", () => {
  const g = groupCells([{ a: 0, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 0 }, { a: 1, b: 1 }]);
  const keys = g[0].links.map(([i, j]) => [Math.min(i, j), Math.max(i, j)].join("-"));
  assert.equal(new Set(keys).size, keys.length);
});

test("median of odd and even lists", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
});

test("roughness levels follow the rank among all cells and need enough cells", () => {
  const all = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(roughnessLevel(1, all)?.label, "Smoother");
  assert.equal(roughnessLevel(20, all)?.label, "Roughest");
  assert.ok((roughnessLevel(20, all)?.pct ?? 0) > 90);
  assert.equal(roughnessLevel(5, all.slice(0, MIN_CELLS_TO_COMPARE - 1)), null);
});

test("rankPct treats ties as half", () => {
  assert.equal(rankPct(2, [2, 2, 2, 2]), 50);
});

test("speed levels use absolute thresholds", () => {
  assert.equal(speedLevel(5).label, "Crawling");
  assert.equal(speedLevel(12).label, "Slow");
  assert.equal(speedLevel(25).label, "Moderate");
  assert.equal(speedLevel(45).label, "Flowing");
});

import { nameFrom, formatCoord } from "./place.ts";

test("place names combine road and area, and degrade to whatever exists", () => {
  assert.equal(nameFrom({ address: { road: "Herbert Macaulay Way", suburb: "Yaba" } }), "Herbert Macaulay Way, Yaba");
  assert.equal(nameFrom({ address: { road: "Marina" } }), "Marina");
  assert.equal(nameFrom({ address: { suburb: "Yaba" } }), "Yaba");
  assert.equal(nameFrom({ address: { country: "Nigeria" } }), null);
  assert.equal(nameFrom({}), null);
});

test("coordinates are formatted with hemispheres", () => {
  assert.equal(formatCoord(6.5362, 3.3866), "6.5362° N, 3.3866° E");
  assert.equal(formatCoord(-1.5, -2.25), "1.5000° S, 2.2500° W");
});
