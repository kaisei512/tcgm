(function initDomain(global) {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function asPositiveInteger(value, fallback = 1) {
    const normalized = Math.floor(Number(value) || fallback);
    return Math.max(1, normalized);
  }

  function asMoney(value) {
    return Math.max(0, Math.round(Number(value) || 0));
  }

  function normalizedKind(item) {
    const kind = item?.kind;
    return ["box", "pack", "single", "other"].includes(kind) ? kind : "other";
  }

  function openInventoryItem({ item, openQuantity, singles = [], openedAt, noHit = false, idFactory }) {
    if (!item) throw new Error("item is required");
    if (typeof idFactory !== "function") throw new Error("idFactory is required");

    const quantity = asPositiveInteger(item.quantity);
    const originalName = item.name || "";
    const originalCost = asMoney(item.acquisitionCost);
    const originalValue = asMoney(item.currentValue);
    const openedQuantity = Math.min(quantity, asPositiveInteger(openQuantity));
    const openedCost = Math.round((originalCost / quantity) * openedQuantity);
    const openedValue = Math.round((originalValue / quantity) * openedQuantity);

    const openedItem = {
      ...item,
      name: `${originalName} 開封分`,
      quantity: openedQuantity,
      acquisitionCost: openedCost,
      currentValue: noHit ? 0 : openedValue,
      status: "opened",
      openedAt
    };

    const remainingQuantity = quantity - openedQuantity;
    const remainingItem = remainingQuantity > 0
      ? {
          id: idFactory(),
          name: `${originalName} 未開封残`,
          kind: normalizedKind(item),
          purpose: "sell",
          quantity: remainingQuantity,
          acquiredAt: item.acquiredAt,
          acquisitionCost: Math.max(0, originalCost - openedCost),
          currentValue: Math.max(0, originalValue - openedValue),
          memo: `${openedQuantity}個開封後の未開封残。売却予定。`,
          status: "active",
          sourceBoxId: item.id
        }
      : null;

    const singleItems = noHit
      ? []
      : singles
          .map((single) => ({
            id: idFactory(),
            name: String(single.name || "").trim(),
            kind: "single",
            purpose: "opened_single",
            quantity: 1,
            acquiredAt: openedAt,
            acquisitionCost: 0,
            currentValue: asMoney(single.currentValue),
            memo: `パック開封: ${originalName}`,
            status: "active",
            sourceBoxId: item.id
          }))
          .filter((single) => single.name);

    return {
      openedItem,
      remainingItem,
      singleItems,
      transaction: {
        id: idFactory(),
        type: "open_box",
        date: openedAt,
        label: originalName,
        sourceBoxId: item.id,
        amount: openedCost,
        memo: noHit
          ? `${openedQuantity}個開封: 当たりなし（評価額0円）`
          : `${openedQuantity}個開封: ${singleItems.length}件のシングルへ変換`,
        undo: {
          action: "open_box",
          beforeItems: [clone(item)],
          addedInventoryIds: [
            ...(remainingItem ? [remainingItem.id] : []),
            ...singleItems.map((single) => single.id)
          ]
        }
      }
    };
  }

  function cancelLatestTransaction(state) {
    if (!state || !Array.isArray(state.inventory) || !Array.isArray(state.transactions)) {
      throw new Error("state with inventory and transactions is required");
    }
    if (!state.transactions.length) {
      return { changed: false, message: "取り消せる履歴がありません。" };
    }

    const transactions = clone(state.transactions);
    const inventory = clone(state.inventory);
    const tx = transactions.pop();

    if (tx.undo?.action === "purchase") {
      return {
        changed: true,
        state: {
          ...state,
          transactions,
          inventory: inventory.filter((item) => !tx.undo.addedInventoryIds.includes(item.id))
        },
        transaction: tx
      };
    }

    if (tx.undo?.action === "sale") {
      const before = tx.undo.beforeItems[0];
      const index = inventory.findIndex((item) => item.id === before.id);
      if (index >= 0) inventory[index] = clone(before);
      return { changed: true, state: { ...state, transactions, inventory }, transaction: tx };
    }

    if (tx.undo?.action === "open_box") {
      const before = tx.undo.beforeItems[0];
      const withoutAdded = inventory.filter((item) => !tx.undo.addedInventoryIds.includes(item.id));
      const index = withoutAdded.findIndex((item) => item.id === before.id);
      if (index >= 0) withoutAdded[index] = clone(before);
      return { changed: true, state: { ...state, transactions, inventory: withoutAdded }, transaction: tx };
    }

    if (tx.type === "purchase" && tx.inventoryId) {
      return {
        changed: true,
        state: {
          ...state,
          transactions,
          inventory: inventory.filter((item) => item.id !== tx.inventoryId)
        },
        transaction: tx
      };
    }

    if (tx.type === "sale" && tx.inventoryId) {
      const item = inventory.find((row) => row.id === tx.inventoryId);
      if (item) {
        item.status = "active";
        delete item.soldAt;
      }
      return { changed: true, state: { ...state, transactions, inventory }, transaction: tx };
    }

    if (tx.type === "open_box" && tx.sourceBoxId) {
      const source = inventory.find((item) => item.id === tx.sourceBoxId);
      const children = inventory.filter((item) => item.sourceBoxId === tx.sourceBoxId);
      if (source) {
        const remaining = children.find((item) => item.status === "active" && item.kind !== "single");
        source.name = source.name.replace(/ 開封分$/, "");
        source.status = "active";
        delete source.openedAt;
        if (remaining) {
          source.quantity = asPositiveInteger(source.quantity) + asPositiveInteger(remaining.quantity);
          source.acquisitionCost = asMoney(source.acquisitionCost) + asMoney(remaining.acquisitionCost);
          source.currentValue = asMoney(source.currentValue) + asMoney(remaining.currentValue);
        }
      }
      return {
        changed: true,
        state: {
          ...state,
          transactions,
          inventory: inventory.filter((item) => item.id === tx.sourceBoxId || item.sourceBoxId !== tx.sourceBoxId)
        },
        transaction: tx
      };
    }

    return { changed: true, state: { ...state, transactions, inventory }, transaction: tx };
  }

  const api = { asPositiveInteger, asMoney, normalizedKind, openInventoryItem, cancelLatestTransaction };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TCGMDomain = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
