// Fictional seed data. Recreates data/tapak.db on every `bun run setup`.
import type { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { config } from "../apps/server/src/config.ts";
import { openDb } from "../apps/server/src/db.ts";

type C = [id: string, name: string, email: string, phone: string, address: string];
export const CUSTOMERS: C[] = [
  ["c01", "Rina Putri", "rina.putri@example.com", "+62 812-1111-0001", "Jl. Kemang Raya 12, Jakarta Selatan"],
  ["c02", "Rina Putri", "rina.p@example.org", "+62 812-1111-0002", "Jl. Dago 88, Bandung"],
  ["c03", "Budi Santoso", "budi.santoso@example.com", "+62 813-2222-0003", "Jl. Pemuda 5, Semarang"],
  ["c04", "Ayu Lestari", "ayu.lestari@example.com", "+62 811-3333-0004", "Jl. Malioboro 21, Yogyakarta"],
  ["c05", "Dimas Pratama", "dimas.p@example.com", "+62 857-4444-0005", "Jl. Darmo 40, Surabaya"],
  ["c06", "Sari Wulandari", "sari.w@example.com", "+62 878-5555-0006", "Jl. Gatot Subroto 3, Medan"],
  ["c07", "Andi Wijaya", "andi.wijaya@example.com", "+62 812-6666-0007", "Jl. Sudirman 77, Makassar"],
  ["c08", "Maya Anggraini", "maya.a@example.com", "+62 819-7777-0008", "Jl. Teuku Umar 9, Denpasar"],
  ["c09", "Fajar Nugroho", "fajar.n@example.com", "+62 821-8888-0009", "Jl. Diponegoro 14, Malang"],
  ["c10", "Putri Amelia", "putri.amelia@example.com", "+62 822-9999-0010", "Jl. Ahmad Yani 60, Balikpapan"],
  ["c11", "Rizky Ramadhan", "rizky.r@example.com", "+62 838-1010-0011", "Jl. Veteran 2, Palembang"],
  ["c12", "Dewi Kartika", "dewi.kartika@example.com", "+62 852-1212-0012", "Jl. Pajajaran 31, Bogor"],
];

// [id, customer, status, created_at, delivered_at, eta, carrier, tracking]
type O = [string, string, string, string, string | null, string | null, string | null, string | null];
export const ORDERS: O[] = [
  ["TPK-10001", "c01", "shipped", "2026-09-28", null, "2026-10-06", "JNE", "JNE7700100001"],
  ["TPK-10002", "c01", "delivered", "2026-09-10", "2026-09-13", "2026-09-13", "JNE", "JNE7700100002"],
  ["TPK-10003", "c02", "paid", "2026-10-03", null, "2026-10-08", null, null],
  ["TPK-10004", "c03", "packed", "2026-10-02", null, "2026-10-07", "SiCepat", null],
  ["TPK-10005", "c03", "delivered", "2026-08-01", "2026-08-04", "2026-08-04", "SiCepat", "SCP880010005"],
  ["TPK-10006", "c04", "lost", "2026-09-05", null, "2026-09-09", "J&T", "JT9900010006"],
  ["TPK-10007", "c04", "shipped", "2026-09-30", null, "2026-10-05", "J&T", "JT9900010007"],
  ["TPK-10008", "c05", "delivered", "2026-09-20", "2026-09-23", "2026-09-23", "JNE", "JNE7700100008"],
  ["TPK-10009", "c05", "returned", "2026-08-15", "2026-08-18", "2026-08-18", "JNE", "JNE7700100009"],
  ["TPK-10010", "c06", "cancelled", "2026-09-25", null, null, null, null],
  ["TPK-10011", "c06", "shipped", "2026-09-27", null, "2026-10-03", "SiCepat", "SCP880010011"],
  ["TPK-10012", "c07", "delivered", "2026-07-20", "2026-07-26", "2026-07-26", "J&T", "JT9900010012"],
  ["TPK-10013", "c07", "paid", "2026-10-04", null, "2026-10-10", null, null],
  ["TPK-10014", "c08", "shipped", "2026-10-01", null, "2026-10-06", "JNE", "JNE7700100014"],
  ["TPK-10015", "c08", "delivered", "2026-09-01", "2026-09-04", "2026-09-04", "JNE", "JNE7700100015"],
  ["TPK-10016", "c09", "packed", "2026-10-03", null, "2026-10-07", "JNE", null],
  ["TPK-10017", "c09", "delivered", "2026-09-15", "2026-09-17", "2026-09-17", "SiCepat", "SCP880010017"],
  ["TPK-10018", "c10", "shipped", "2026-09-26", null, "2026-10-02", "J&T", "JT9900010018"],
  ["TPK-10019", "c10", "lost", "2026-09-12", null, "2026-09-18", "SiCepat", "SCP880010019"],
  ["TPK-10020", "c11", "delivered", "2026-08-25", "2026-08-29", "2026-08-29", "JNE", "JNE7700100020"],
  ["TPK-10021", "c11", "paid", "2026-10-02", null, "2026-10-09", null, null],
  ["TPK-10022", "c12", "shipped", "2026-10-02", null, "2026-10-05", "JNE", "JNE7700100022"],
  ["TPK-10023", "c12", "delivered", "2026-09-22", "2026-09-24", "2026-09-24", "JNE", "JNE7700100023"],
  ["TPK-10024", "c02", "returned", "2026-09-01", "2026-09-04", "2026-09-04", "JNE", "JNE7700100024"],
  ["TPK-10025", "c03", "cancelled", "2026-09-29", null, null, null, null],
];

type I = [order: string, sku: string, name: string, size: number, qty: number, price: number];
export const ITEMS: I[] = [
  ["TPK-10001", "TPK-RUN-01", "Langkah Runner", 41, 1, 649000],
  ["TPK-10002", "TPK-LTH-02", "Kulit Derby", 42, 1, 899000],
  ["TPK-10003", "TPK-SUE-03", "Senja Suede Loafer", 38, 1, 749000],
  ["TPK-10004", "TPK-RUN-01", "Langkah Runner", 43, 1, 649000],
  ["TPK-10004", "TPK-SOX-09", "Everyday Socks 3-pack", 42, 1, 99000],
  ["TPK-10005", "TPK-MSH-04", "Angin Mesh Trainer", 42, 1, 599000],
  ["TPK-10006", "TPK-LTH-02", "Kulit Derby", 39, 1, 899000],
  ["TPK-10007", "TPK-SND-05", "Pantai Sandal", 39, 2, 299000],
  // Mixed sizes in one order (edge case).
  ["TPK-10008", "TPK-RUN-01", "Langkah Runner", 40, 1, 649000],
  ["TPK-10008", "TPK-RUN-01", "Langkah Runner", 41, 1, 649000],
  ["TPK-10009", "TPK-BOO-06", "Gunung Boot", 43, 1, 1199000],
  ["TPK-10010", "TPK-SUE-03", "Senja Suede Loafer", 37, 1, 749000],
  ["TPK-10011", "TPK-MSH-04", "Angin Mesh Trainer", 38, 1, 599000],
  ["TPK-10012", "TPK-LTH-02", "Kulit Derby", 44, 1, 899000],
  ["TPK-10013", "TPK-KID-07", "Kecil Sneaker", 30, 2, 349000],
  ["TPK-10014", "TPK-RUN-01", "Langkah Runner", 39, 1, 649000],
  ["TPK-10015", "TPK-SND-05", "Pantai Sandal", 40, 1, 299000],
  ["TPK-10016", "TPK-BOO-06", "Gunung Boot", 42, 1, 1199000],
  ["TPK-10017", "TPK-MSH-04", "Angin Mesh Trainer", 41, 1, 599000],
  ["TPK-10017", "TPK-SUE-03", "Senja Suede Loafer", 41, 1, 749000],
  ["TPK-10017", "TPK-SOX-09", "Everyday Socks 3-pack", 41, 1, 99000],
  ["TPK-10018", "TPK-LTH-02", "Kulit Derby", 40, 1, 899000],
  ["TPK-10019", "TPK-RUN-01", "Langkah Runner", 37, 1, 649000],
  ["TPK-10020", "TPK-BOO-06", "Gunung Boot", 44, 1, 1199000],
  ["TPK-10021", "TPK-SUE-03", "Senja Suede Loafer", 40, 1, 749000],
  ["TPK-10022", "TPK-MSH-04", "Angin Mesh Trainer", 37, 1, 599000],
  ["TPK-10023", "TPK-SND-05", "Pantai Sandal", 38, 1, 299000],
  ["TPK-10024", "TPK-LTH-02", "Kulit Derby", 38, 1, 899000],
  ["TPK-10025", "TPK-RUN-01", "Langkah Runner", 42, 1, 649000],
];

export function seedDb(db: Database): void {
  const tx = db.transaction(() => {
    const c = db.prepare("INSERT INTO customers (id,name,email,phone,address) VALUES (?,?,?,?,?)");
    for (const row of CUSTOMERS) c.run(...row);
    const o = db.prepare(
      "INSERT INTO orders (id,customer_id,status,created_at,delivered_at,eta,carrier,tracking_no) VALUES (?,?,?,?,?,?,?,?)",
    );
    for (const row of ORDERS) o.run(...row);
    const i = db.prepare("INSERT INTO order_items (order_id,sku,name,size_eu,qty,price) VALUES (?,?,?,?,?,?)");
    for (const row of ITEMS) i.run(...row);
  });
  tx();
}

if (import.meta.main) {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(config.dbPath + suffix, { force: true });
  const db = openDb();
  seedDb(db);
  const n = db.query("SELECT COUNT(*) AS n FROM orders").get() as { n: number };
  console.log(`seeded ${CUSTOMERS.length} customers, ${n.n} orders -> ${config.dbPath}`);
  db.close();
}
