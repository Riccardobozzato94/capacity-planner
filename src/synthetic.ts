import type { Demand, Member } from "./types.ts";

export const SEED = 20261119;

const POOL: Member[] = [
  { id: "AL", name: "AL", role: "Dev", skills: ["TypeScript", "Pimcore", "API"], availableHours: 32 },
  { id: "MR", name: "MR", role: "Dev", skills: ["Magento", "Shopware", "TypeScript"], availableHours: 30 },
  { id: "GB", name: "GB", role: "Dev", skills: ["TypeScript", "API", "Magento"], availableHours: 28 },
  { id: "SC", name: "SC", role: "UX", skills: ["UX", "Pimcore"], availableHours: 24 },
  { id: "LP", name: "LP", role: "QA", skills: ["QA", "Pimcore"], availableHours: 26 },
  { id: "FM", name: "FM", role: "Dev", skills: ["Shopware", "API"], availableHours: 30 },
  { id: "RD", name: "RD", role: "Integrazione", skills: ["API", "Magento", "Shopware"], availableHours: 32 },
  { id: "TV", name: "TV", role: "QA", skills: ["QA", "TypeScript"], availableHours: 24 },
  { id: "EC", name: "EC", role: "UX", skills: ["UX", "Magento"], availableHours: 22 },
  { id: "GN", name: "GN", role: "Integrazione", skills: ["API", "Pimcore", "QA"], availableHours: 28 },
];

function demand(
  id: string,
  title: string,
  skill: string,
  effortHours: number,
  priority: Demand["priority"]
): Demand {
  return { id, title, skill, effortHours, priority };
}

export const SPRINTS: Array<{ name: string; members: Member[]; demands: Demand[] }> = [
  {
    name: "S1",
    members: [...POOL],
    demands: [
      demand("d01", "Integrazione API ordini", "API", 12, "high"),
      demand("d02", "Migrazione catalogo Pimcore", "Pimcore", 16, "high"),
      demand("d03", "Checkout Magento", "Magento", 10, "high"),
      demand("d04", "Test regressione QA", "QA", 10, "high"),
      demand("d05", "Schermate UX carrello", "UX", 8, "medium"),
      demand("d06", "Plugin Shopware", "Shopware", 12, "medium"),
      demand("d07", "Documentazione API", "API", 6, "medium"),
      demand("d08", "Import Pimcore", "Pimcore", 8, "medium"),
      demand("d09", "Audit UX ricerca", "UX", 6, "medium"),
      demand("d10", "Integrazione Shopware", "Shopware", 8, "medium"),
      demand("d11", "Refactor TypeScript", "TypeScript", 8, "low"),
      demand("d12", "Fix Magento", "Magento", 4, "low"),
    ],
  },
  {
    name: "S2",
    members: POOL.filter((m) => m.id !== "EC"),
    demands: [
      demand("d01", "Sync API ordini", "API", 10, "high"),
      demand("d02", "Template Pimcore", "Pimcore", 14, "high"),
      demand("d03", "Test QA end-to-end", "QA", 12, "high"),
      demand("d04", "Estensione Magento", "Magento", 12, "medium"),
      demand("d05", "Modulo Shopware", "Shopware", 10, "medium"),
      demand("d06", "API autenticazione", "API", 8, "medium"),
      demand("d07", "UI UX checkout", "UX", 6, "medium"),
      demand("d08", "TypeScript build", "TypeScript", 6, "low"),
      demand("d09", "Pimcore import", "Pimcore", 6, "low"),
      demand("d10", "Fix Magento", "Magento", 4, "low"),
      // Nessun membro di S2 ha la skill Kafka: la demand resta non assegnata
      // con motivo esplicito, senza ricorrere a una probe nell'eval.
      demand("d11", "Integrazione eventi Kafka", "Kafka", 8, "high"),
    ],
  },
  {
    name: "S3",
    // SC e' l'unico UX di S3: 12 h assegnate su 14 h disponibili lo portano
    // oltre la soglia 85%, rendendo visibile lo stato di overload nel dataset.
    members: POOL.filter((m) => m.id !== "EC" && m.id !== "TV").map((m) =>
      m.id === "SC" ? { ...m, availableHours: 14 } : { ...m }
    ),
    demands: [
      demand("d01", "Integrazione API pagamenti", "API", 14, "high"),
      demand("d02", "Catalogo Pimcore", "Pimcore", 12, "high"),
      demand("d03", "QA regressione", "QA", 10, "high"),
      demand("d04", "Magento prodotto", "Magento", 10, "high"),
      demand("d05", "Shopware check", "Shopware", 8, "medium"),
      demand("d06", "UX navigazione", "UX", 8, "medium"),
      demand("d07", "TypeScript shared", "TypeScript", 8, "medium"),
      demand("d08", "API reporting", "API", 6, "medium"),
      demand("d09", "Pimcore media", "Pimcore", 6, "medium"),
      demand("d10", "Fix Shopware", "Shopware", 4, "low"),
      demand("d11", "Test QA", "QA", 6, "low"),
      demand("d12", "Magento cache", "Magento", 4, "low"),
      demand("d13", "UX accessibilità", "UX", 4, "low"),
    ],
  },
  {
    name: "S4",
    members: [...POOL],
    demands: [
      demand("d01", "API ordini", "API", 12, "high"),
      demand("d02", "Pimcore migrazione", "Pimcore", 16, "high"),
      demand("d03", "QA critico", "QA", 12, "high"),
      demand("d04", "Magento checkout", "Magento", 12, "high"),
      demand("d05", "UX dashboard", "UX", 10, "high"),
      demand("d06", "Shopware estensioni", "Shopware", 12, "medium"),
      demand("d07", "TypeScript refactor", "TypeScript", 10, "medium"),
      demand("d08", "API integrazione", "API", 8, "medium"),
      demand("d09", "Pimcore template", "Pimcore", 8, "medium"),
      demand("d10", "Magento fix", "Magento", 6, "medium"),
      demand("d11", "QA smoke", "QA", 6, "low"),
      demand("d12", "Shopware sync", "Shopware", 6, "low"),
      demand("d13", "UX ricerca", "UX", 4, "low"),
      demand("d14", "TypeScript test", "TypeScript", 4, "low"),
    ],
  },
];
