/**
 * FORK MIA — O CONVITE DE EQUIPE VALE 15 DIAS.
 *
 * No upstream o convite vale 24h. Numa implantação, quem é convidado (o dono da
 * empresa, a equipe do cliente) raramente abre o e-mail no mesmo dia: o convite
 * vencia e virava pedido de reenvio. O prazo mora numa constante de um arquivo
 * do upstream (`lib/auth/invite-token.ts`), então uma sincronização pode
 * devolvê-lo às 24h sem conflito visível. Este arquivo reprova quando isso
 * acontecer.
 *
 * O que se prova:
 *
 *   - a constante é de 15 dias;
 *   - um convite assinado com o prazo cheio continua válido no 14º dia e deixa
 *     de valer depois do 15º (o aceite usa a mesma conta);
 *   - a tela de aceite não promete mais "24h".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { INVITE_TTL_SECONDS, signInviteToken, verifyInviteToken } from "@/lib/auth/invite-token";

const DIA = 24 * 60 * 60;
const AGORA = Date.parse("2026-10-05T12:00:00Z");

function convite() {
  const iat = Math.floor(AGORA / 1000);
  return signInviteToken({
    invite_id: "11111111-1111-4111-8111-111111111111",
    email: "pessoa@exemplo.invalid",
    organization_id: "22222222-2222-4222-8222-222222222222",
    role: "admin",
    iat,
    exp: iat + INVITE_TTL_SECONDS,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("o convite de equipe vale 15 dias", () => {
  it("a constante é de 15 dias", () => {
    expect(INVITE_TTL_SECONDS).toBe(15 * DIA);
  });

  it("vale no 14º dia e deixa de valer depois do 15º", () => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
    const token = convite();

    vi.setSystemTime(AGORA + 14 * DIA * 1000);
    expect(verifyInviteToken(token)?.email).toBe("pessoa@exemplo.invalid");

    vi.setSystemTime(AGORA + (15 * DIA + 60) * 1000);
    expect(verifyInviteToken(token)).toBeNull();
  });

  it("a tela de aceite não promete 24h", () => {
    const tela = readFileSync(join(process.cwd(), "app/team/accept-invite/[token]/page.tsx"), "utf8");
    expect(tela).not.toMatch(/24 ?h/);
    expect(tela).toContain("o prazo do convite já passou");
  });
});
