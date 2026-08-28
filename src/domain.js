(function initDomain(global) {
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
          : `${openedQuantity}個開封: ${singleItems.length}件のシングルへ変換`
      }
    };
  }

  const api = { asPositiveInteger, asMoney, normalizedKind, openInventoryItem };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TCGMDomain = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
