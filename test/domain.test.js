const assert = require("node:assert/strict");
const test = require("node:test");

const { openInventoryItem } = require("../src/domain.js");

function idFactory() {
  let next = 1;
  return () => `id-${next++}`;
}

function pack(overrides = {}) {
  return {
    id: "pack-1",
    name: "テストパック",
    kind: "pack",
    purpose: "open",
    quantity: 10,
    acquiredAt: "2026-08-28",
    acquisitionCost: 10000,
    currentValue: 12000,
    memo: "開封予定",
    status: "active",
    ...overrides
  };
}

test("一部開封では開封分と未開封残に分け、未開封残を売却予定にする", () => {
  const result = openInventoryItem({
    item: pack(),
    openQuantity: 3,
    singles: [{ name: "当たりカード", currentValue: 5000 }],
    openedAt: "2026-08-28",
    idFactory: idFactory()
  });

  assert.equal(result.openedItem.name, "テストパック 開封分");
  assert.equal(result.openedItem.status, "opened");
  assert.equal(result.openedItem.quantity, 3);
  assert.equal(result.openedItem.acquisitionCost, 3000);
  assert.equal(result.openedItem.currentValue, 3600);

  assert.equal(result.remainingItem.name, "テストパック 未開封残");
  assert.equal(result.remainingItem.quantity, 7);
  assert.equal(result.remainingItem.acquisitionCost, 7000);
  assert.equal(result.remainingItem.currentValue, 8400);
  assert.equal(result.remainingItem.purpose, "sell");
  assert.equal(result.remainingItem.status, "active");

  assert.equal(result.singleItems.length, 1);
  assert.equal(result.singleItems[0].kind, "single");
  assert.equal(result.singleItems[0].purpose, "opened_single");
  assert.equal(result.singleItems[0].acquisitionCost, 0);
  assert.equal(result.singleItems[0].currentValue, 5000);
});

test("全開封では未開封残を作らない", () => {
  const result = openInventoryItem({
    item: pack(),
    openQuantity: 10,
    singles: [{ name: "当たりカード", currentValue: 5000 }],
    openedAt: "2026-08-28",
    idFactory: idFactory()
  });

  assert.equal(result.openedItem.quantity, 10);
  assert.equal(result.openedItem.acquisitionCost, 10000);
  assert.equal(result.remainingItem, null);
  assert.equal(result.singleItems.length, 1);
  assert.equal(result.transaction.amount, 10000);
});

test("当たりなしではシングルを作らず、開封分の評価額を0にする", () => {
  const result = openInventoryItem({
    item: pack(),
    openQuantity: 10,
    noHit: true,
    openedAt: "2026-08-28",
    idFactory: idFactory()
  });

  assert.equal(result.openedItem.acquisitionCost, 10000);
  assert.equal(result.openedItem.currentValue, 0);
  assert.equal(result.remainingItem, null);
  assert.deepEqual(result.singleItems, []);
  assert.equal(result.transaction.memo, "10個開封: 当たりなし（評価額0円）");
});

test("開封数が在庫数を超える場合は全開封として扱う", () => {
  const result = openInventoryItem({
    item: pack({ quantity: 5, acquisitionCost: 2500, currentValue: 3000 }),
    openQuantity: 99,
    singles: [{ name: "カード", currentValue: 100 }],
    openedAt: "2026-08-28",
    idFactory: idFactory()
  });

  assert.equal(result.openedItem.quantity, 5);
  assert.equal(result.openedItem.acquisitionCost, 2500);
  assert.equal(result.remainingItem, null);
});

test("空のシングル名は登録しない", () => {
  const result = openInventoryItem({
    item: pack(),
    openQuantity: 1,
    singles: [
      { name: "  ", currentValue: 500 },
      { name: "登録カード", currentValue: 1200 }
    ],
    openedAt: "2026-08-28",
    idFactory: idFactory()
  });

  assert.equal(result.singleItems.length, 1);
  assert.equal(result.singleItems[0].name, "登録カード");
});
