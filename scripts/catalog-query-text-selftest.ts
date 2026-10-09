import { catalogSearchIlikeTerm } from "@/lib/products/catalog-query-text";

const cases: [string, string | null][] = [
  ["healthy noodles", "noodles"],
  ["healthy maggi", "maggi"],
  ["amul milk", "amul milk"],
  ["low sugar biscuits", "biscuits"],
  ["sugar free coke", "coke"],
  ["organic milk", "milk"],
  ["zero sugar soft drinks", "soft drinks"],
];

let failed = 0;
for (const [q, want] of cases) {
  const got = catalogSearchIlikeTerm(q);
  if (got !== want) {
    console.error(`FAIL "${q}": got ${got}, want ${want}`);
    failed++;
  }
}
if (failed) process.exit(1);
console.log("catalog-query-text selftest passed");
