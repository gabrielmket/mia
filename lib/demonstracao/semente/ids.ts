/**
 * FORK MIA · CLIENTE MODELO — os ids da semente são ESTÁVEIS.
 *
 * A semente roda quantas vezes for preciso (para renovar as datas da agenda,
 * para acrescentar um caso novo) e não pode duplicar nada. O jeito mais simples
 * e mais à prova de erro de garantir isso é cada linha ter SEMPRE o mesmo id:
 * rodar de novo vira `on conflict (id) do update`, e não uma busca por nome que
 * erra no primeiro acento trocado.
 *
 * O id é um UUID versão 5 (RFC 4122 §4.3, SHA-1 sobre um namespace e um nome).
 * O namespace é desta semente e de mais nada: o mesmo nome em outro lugar do
 * produto nunca cai no mesmo id.
 */
import { createHash } from "node:crypto";

/** Namespace da semente do cliente modelo. Trocar muda TODOS os ids: não troque. */
const NAMESPACE = "6d1a3f0e-9010-5c1e-8a2d-6d6f64656c6f";

function bytesDoUuid(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

/** UUID v5 determinístico para uma chave da semente (`contato:marina`, `lead:clinica:1`). */
export function idEstavel(chave: string): string {
  const hash = createHash("sha1")
    .update(Buffer.concat([bytesDoUuid(NAMESPACE), Buffer.from(chave, "utf8")]))
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50; // versão 5
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
