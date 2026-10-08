const assert = require("node:assert/strict");
const test = require("node:test");

const { addMonths, assetsAtMonth, monthlyAssetChange, cashFlowForMonth, summarizeInventory, cancelLatestTransaction, openInventoryItem } = require("../src/domain.js");

test("今月の現金減少より純資産減少が大きい場合、差額は在庫評価額の減少で説明できる", () => {
  const before = pack({ acquisitionCost: 10000, currentValue: 10000 });
  const opening = openInventoryItem({ item: before, openQuantity: 10, noHit: true,
    openedAt: "2026-10-01", idFactory: idFactory() });
  const state = { settings: { initialCash: 20000 }, inventory: [opening.openedItem],
    transactions: [
      { type: "purchase", date: before.acquiredAt, amount: 10000, inventoryId: before.id },
      opening.transaction,
      { type: "expense", date: "2026-10-02", amount: 2200 }
    ] };
  const result = monthlyAssetChange(state, "2026-10");
  assert.equal(result.cashChange, -2200);
  assert.equal(result.inventoryChange, -10000);
  assert.equal(result.netChange, -12200);
  assert.equal(result.cashChange, cashFlowForMonth(state, "2026-10").net);
  assert.equal(result.netChange, result.cashChange + result.inventoryChange);
});

test("原価と同額の在庫を仕入れるだけなら現金が減っても純資産前月比は0", () => {
  const state = { settings: { initialCash: 20000 },
    inventory: [pack({ acquiredAt: "2026-10-01", acquisitionCost: 2200, currentValue: 2200 })],
    transactions: [{ type: "purchase", date: "2026-10-01", inventoryId: "pack-1", amount: 2200 }] };
  const result = monthlyAssetChange(state, "2026-10");
  assert.equal(result.cashChange, -2200);
  assert.equal(result.inventoryChange, 2200);
  assert.equal(result.netChange, 0);
});

test("売却控除が未設定の旧データでも月次現金と純資産の現金差分が一致する", () => {
  const state = { settings: { initialCash: 0 }, inventory: [],
    transactions: [{ type: "sale", date: "2026-10-01", gross: "40000", fee: "4000" }] };
  assert.equal(cashFlowForMonth(state, "2026-10").net, 36000);
  assert.equal(monthlyAssetChange(state, "2026-10").cashChange, 36000);
});

test("在庫区分は開封予定と旧区分と未分類も含み、評価額・原価・含み損益の総額が一致する", () => {
  const inventory = [
    { purpose: "sell", acquisitionCost: 100, currentValue: 150 },
    { purpose: "rotating", acquisitionCost: 200, currentValue: 150 },
    { purpose: "hold", acquisitionCost: 300, currentValue: 400 },
    { purpose: "investment", acquisitionCost: 100, currentValue: 100 },
    { purpose: "open", acquisitionCost: 1000, currentValue: 800 },
    { purpose: "opened_single", acquisitionCost: 0, currentValue: 500 },
    { purpose: "unknown", acquisitionCost: 50, currentValue: 25 }
  ];
  const groups = summarizeInventory(inventory);
  assert.deepEqual(groups.sell, { cost: 300, value: 300, unrealized: 0 });
  assert.deepEqual(groups.hold, { cost: 400, value: 500, unrealized: 100 });
  assert.deepEqual(groups.open, { cost: 1000, value: 800, unrealized: -200 });
  for (const [field, itemField] of [["cost", "acquisitionCost"], ["value", "currentValue"]]) {
    assert.equal(Object.values(groups).reduce((sum, group) => sum + group[field], 0),
      inventory.reduce((sum, item) => sum + item[itemField], 0));
  }
  assert.equal(Object.values(groups).reduce((sum, group) => sum + group.unrealized, 0), 375);
});

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

test("月末集計は翌月の仕入と現金支出を除外する", () => {
  const state = {
    settings: { initialCash: 20000 },
    inventory: [pack({ acquiredAt: "2026-10-01" })],
    transactions: [{ type: "purchase", date: "2026-10-01", inventoryId: "pack-1", amount: 10000 }]
  };
  assert.equal(assetsAtMonth(state, "2026-09").netAssets, 20000);
  assert.equal(assetsAtMonth(state, "2026-09").totalCost, 0);
  assert.equal(assetsAtMonth(state, "2026-10").netAssets, 22000);
});

test("部分開封前月は分割前の在庫を復元し残りパックを二重計上しない", () => {
  const before = pack();
  const opening = openInventoryItem({ item: before, openQuantity: 3,
    singles: [{ name: "card", currentValue: 5000 }], openedAt: "2026-09-01", idFactory: idFactory() });
  const state = {
    settings: { initialCash: 10000 },
    inventory: [opening.openedItem, opening.remainingItem, ...opening.singleItems],
    transactions: [{ type: "purchase", date: before.acquiredAt, amount: 10000, inventoryId: before.id }, opening.transaction]
  };
  const original = JSON.stringify(state);
  const august = assetsAtMonth(state, "2026-08");
  const september = assetsAtMonth(state, "2026-09");
  assert.equal(august.marketValue, 12000);
  assert.equal(august.totalCost, 10000);
  assert.equal(august.inventory.length, 1);
  assert.equal(september.totalCost, 7000);
  assert.equal(september.marketValue, 13400);
  assert.equal(september.netAssets - august.netAssets, 1400);
  assert.equal(JSON.stringify(state), original);
});

test("全開封で当たりなしなら保有原価と評価額は0、純資産は開封前評価額だけ減る", () => {
  const before = pack();
  const opening = openInventoryItem({ item: before, openQuantity: 10, noHit: true,
    openedAt: "2026-09-01", idFactory: idFactory() });
  const state = { settings: { initialCash: 10000 }, inventory: [opening.openedItem],
    transactions: [{ type: "purchase", date: before.acquiredAt, amount: 10000, inventoryId: before.id }, opening.transaction] };
  const september = assetsAtMonth(state, "2026-09");
  assert.equal(september.totalCost, 0);
  assert.equal(september.marketValue, 0);
  assert.equal(september.netAssets - assetsAtMonth(state, "2026-08").netAssets, -12000);
  assert.equal(state.inventory[0].acquisitionCost, 10000);
});

test("翌月売却前の月末在庫と評価額を復元する", () => {
  const before = pack();
  const state = { settings: { initialCash: 10000 },
    inventory: [{ ...before, status: "sold", soldAt: "2026-09-01" }],
    transactions: [
      { type: "purchase", date: before.acquiredAt, amount: 10000, inventoryId: before.id },
      { type: "sale", date: "2026-09-01", inventoryId: before.id, gross: 13000,
        undo: { action: "sale", beforeItems: [before] } }
    ] };
  assert.equal(assetsAtMonth(state, "2026-08").netAssets, 12000);
  assert.equal(assetsAtMonth(state, "2026-09").netAssets, 13000);
  assert.equal(assetsAtMonth(state, "2026-09").totalCost, 0);
});

test("月加算はUTC変換で前月にずれない", () => {
  assert.equal(addMonths("2026-10", -2), "2026-08");
  assert.equal(addMonths("2026-10", -1), "2026-09");
  assert.equal(addMonths("2026-10", 0), "2026-10");
  assert.equal(addMonths("2026-01", -1), "2025-12");
});

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

test("購入取消では追加された在庫と仕入履歴を削除する", () => {
  const state = {
    settings: { initialCash: 0 },
    inventory: [pack()],
    transactions: [
      {
        id: "tx-1",
        type: "purchase",
        inventoryId: "pack-1",
        label: "テストパック",
        undo: { action: "purchase", addedInventoryIds: ["pack-1"] }
      }
    ]
  };

  const result = cancelLatestTransaction(state);

  assert.equal(result.changed, true);
  assert.deepEqual(result.state.inventory, []);
  assert.deepEqual(result.state.transactions, []);
});

test("売却取消では売却前の在庫状態に戻す", () => {
  const before = pack({ currentValue: 9000 });
  const sold = { ...before, status: "sold", soldAt: "2026-08-29" };
  const state = {
    settings: { initialCash: 0 },
    inventory: [sold],
    transactions: [
      {
        id: "tx-1",
        type: "sale",
        inventoryId: "pack-1",
        label: "テストパック",
        gross: 9500,
        fee: 950,
        shipping: 200,
        transport: 0,
        undo: { action: "sale", beforeItems: [before] }
      }
    ]
  };

  const result = cancelLatestTransaction(state);

  assert.equal(result.state.inventory.length, 1);
  assert.deepEqual(result.state.inventory[0], before);
  assert.deepEqual(result.state.transactions, []);
});

test("パック開封取消では開封分・未開封残・シングルを開封前に戻す", () => {
  const before = pack();
  const opening = openInventoryItem({
    item: before,
    openQuantity: 3,
    singles: [{ name: "当たりカード", currentValue: 5000 }],
    openedAt: "2026-08-28",
    idFactory: idFactory()
  });
  const state = {
    settings: { initialCash: 0 },
    inventory: [
      opening.openedItem,
      opening.remainingItem,
      ...opening.singleItems
    ],
    transactions: [opening.transaction]
  };

  const result = cancelLatestTransaction(state);

  assert.equal(result.state.inventory.length, 1);
  assert.deepEqual(result.state.inventory[0], before);
  assert.deepEqual(result.state.transactions, []);
});
