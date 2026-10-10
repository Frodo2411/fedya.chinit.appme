// Пакет данных прайса в компактном виде (массивы) и обратно в объекты.
// models: [brand, model, year, ifixit, smartfix{}, smartfixUrl]
// parts:  [supplier, name, cost, stock, svc, tier, [model indexes], line (0 — как name)]

export function decode(b) {
  const models = b.models.map(([brand, model, year, ifixit, sf, sfUrl]) => ({
    brand, model, year: year || null, ifixit: ifixit === undefined ? null : ifixit, sf: sf || null, sfUrl: sfUrl || null,
  }));
  const names = models.map((m) => m.model);
  const parts = b.parts.map(([sup, name, cost, stock, svc, tier, ms, line]) => ({
    sup, name, cost, stock: stock || null, svc, tier, models: ms.map((i) => names[i]), line: line === 0 ? name : line,
  }));
  return {
    v: b.v, priceDate: b.priceDate, sfDate: b.sfDate, suppliers: b.suppliers, models, parts,
    history: b.history || [],
  };
}

export function encode(d) {
  const at = new Map(d.models.map((m, i) => [m.model, i]));
  return {
    v: d.v || 1,
    priceDate: d.priceDate,
    sfDate: d.sfDate,
    suppliers: d.suppliers,
    models: d.models.map((m) => [m.brand, m.model, m.year, m.ifixit, m.sf, m.sfUrl]),
    parts: d.parts.map((p) => [p.sup, p.name, p.cost, p.stock || null, p.svc, p.tier,
      p.models.filter((m) => at.has(m)).map((m) => at.get(m)), p.line === p.name ? 0 : p.line]),
    history: d.history || [],
  };
}
