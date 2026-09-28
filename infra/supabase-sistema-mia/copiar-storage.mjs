// copiar-storage.mjs — copia os ARQUIVOS do Storage da nuvem para o supabase-sistema-mia.
//
// O migrador (migrador/migrar.sh) copia o banco e a lista de baldes; os arquivos
// moram fora do banco (no disco do storage-api) e só passam pela API. Este script
// baixa cada objeto da nuvem com a chave de serviço de lá e sobe no mesmo balde e
// caminho aqui, com a chave de serviço daqui (x-upsert: rodar duas vezes não
// duplica nada).
//
//   node copiar-storage.mjs <objetos.json>
//
// objetos.json: [{ "bucket_id": "...", "name": "...", "mimetype": "..." }, ...]
// (sai de `select bucket_id, name, metadata->>'mimetype' from storage.objects`).
// As URLs e chaves vêm do ambiente — NUVEM_URL, NUVEM_SERVICE_KEY, NOVO_URL,
// NOVO_SERVICE_KEY — e nunca são impressas.
import { readFileSync } from "node:fs";

const { NUVEM_URL, NUVEM_SERVICE_KEY, NOVO_URL, NOVO_SERVICE_KEY } = process.env;
if (!NUVEM_URL || !NUVEM_SERVICE_KEY || !NOVO_URL || !NOVO_SERVICE_KEY) {
  console.error("faltam NUVEM_URL, NUVEM_SERVICE_KEY, NOVO_URL ou NOVO_SERVICE_KEY");
  process.exit(1);
}
const objetos = JSON.parse(readFileSync(process.argv[2], "utf8"));
const caminho = (o) => `${encodeURIComponent(o.bucket_id)}/${o.name.split("/").map(encodeURIComponent).join("/")}`;

let ok = 0;
const falhas = [];
for (const o of objetos) {
  const baixa = await fetch(`${NUVEM_URL}/storage/v1/object/${caminho(o)}`, {
    headers: { apikey: NUVEM_SERVICE_KEY, Authorization: `Bearer ${NUVEM_SERVICE_KEY}` },
  });
  if (!baixa.ok) {
    falhas.push(`${o.bucket_id}/${o.name}: download ${baixa.status}`);
    continue;
  }
  const corpo = Buffer.from(await baixa.arrayBuffer());
  const sobe = await fetch(`${NOVO_URL}/storage/v1/object/${caminho(o)}`, {
    method: "POST",
    headers: {
      apikey: NOVO_SERVICE_KEY,
      Authorization: `Bearer ${NOVO_SERVICE_KEY}`,
      "Content-Type": o.mimetype || baixa.headers.get("content-type") || "application/octet-stream",
      "x-upsert": "true",
    },
    body: corpo,
  });
  if (!sobe.ok) {
    falhas.push(`${o.bucket_id}/${o.name}: upload ${sobe.status} ${(await sobe.text()).slice(0, 120)}`);
    continue;
  }
  ok += 1;
}
console.log(`copiados: ${ok} de ${objetos.length}`);
for (const f of falhas) console.log(`FALHA ${f}`);
process.exit(falhas.length > 0 ? 2 : 0);
