/**
 * FORK MIA (9031) — o TOKEN do link para o dono, a rota pública e a telemetria.
 *
 * O que se prova sem banco (a tabela e as permissões são de
 * `tests/invariants/link-dos-paineis-para-o-dono.test.ts`):
 *
 * 1. O token é DERIVADO do id: o mesmo id dá o mesmo token (é o que deixa
 *    "Copiar link" funcionar a qualquer hora e "Renovar" manter o endereço), ids
 *    diferentes dão tokens diferentes, e a forma é a do alfabeto (24 de 32).
 * 2. O hash tem a forma que a coluna aceita (64 hex), e não contém o token.
 * 3. Malformado não vira busca: `normalizarToken` devolve nulo.
 * 4. A rota pública é UM segmento, com âncora: nada abaixo dela nasce público.
 * 5. A telemetria apaga o token do caminho, como o do convite.
 * 6. A prévia do WhatsApp e afins é reconhecida (não recebe dado, não conta).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/auth/public-paths";
import {
  ALFABETO_DO_TOKEN,
  ehVisitaDePrevia,
  hashDoToken,
  normalizarToken,
  situacaoDoLink,
  TAMANHO_DO_TOKEN,
  tokenDoLink,
} from "@/lib/paineis/link";
import { scrubUrl, urlComCredencial } from "@/lib/sentry/scrub";

const ID = "11111111-1111-4111-8111-111111111111";
const OUTRO_ID = "22222222-2222-4222-8222-222222222222";

describe("o token do link", () => {
  it("⭐ o mesmo id dá o mesmo token; outro id, outro token", () => {
    expect(tokenDoLink(ID)).toBe(tokenDoLink(ID));
    expect(tokenDoLink(ID)).not.toBe(tokenDoLink(OUTRO_ID));
  });

  it("24 caracteres do alfabeto sem i, l, o, u", () => {
    const token = tokenDoLink(ID);
    expect(token).toHaveLength(TAMANHO_DO_TOKEN);
    expect(ALFABETO_DO_TOKEN).toHaveLength(32);
    for (const c of token) expect(ALFABETO_DO_TOKEN).toContain(c);
    expect(ALFABETO_DO_TOKEN).not.toMatch(/[ilou]/);
  });

  it("o hash é 64 hex, e não carrega o token", () => {
    const token = tokenDoLink(ID);
    const hash = hashDoToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashDoToken(token)).toBe(hash);
  });

  it("malformado não vira busca; maiúscula e espaço nas pontas valem", () => {
    const token = tokenDoLink(ID);
    expect(normalizarToken(token)).toBe(token);
    expect(normalizarToken(`  ${token.toUpperCase()} `)).toBe(token);
    expect(normalizarToken(token.slice(1))).toBeNull();
    expect(normalizarToken(`${token}x`)).toBeNull();
    expect(normalizarToken("i".repeat(24))).toBeNull();
    expect(normalizarToken(undefined)).toBeNull();
    expect(normalizarToken(42)).toBeNull();
  });
});

describe("a situação do link", () => {
  it("revogado vence tudo; senão, vencido pela data", () => {
    const agora = Date.parse("2026-10-15T12:00:00Z");
    expect(situacaoDoLink({ revoked_at: null, expires_at: "2026-12-01T00:00:00Z" }, agora)).toBe("ativo");
    expect(situacaoDoLink({ revoked_at: null, expires_at: "2026-10-01T00:00:00Z" }, agora)).toBe("vencido");
    expect(situacaoDoLink({ revoked_at: "2026-10-02T00:00:00Z", expires_at: "2026-12-01T00:00:00Z" }, agora)).toBe("revogado");
  });
});

describe("a rota pública e a telemetria", () => {
  it("⭐ /painel/<token> é público, com âncora: nada abaixo dele nem a raiz", () => {
    const token = tokenDoLink(ID);
    expect(isPublicPath(`/painel/${token}`)).toBe(true);
    expect(isPublicPath(`/painel/${token}/dados`)).toBe(false);
    expect(isPublicPath("/painel")).toBe(false);
    expect(isPublicPath("/painel/")).toBe(false);
    // A tela de dentro continua exigindo sessão.
    expect(isPublicPath("/app/paineis")).toBe(false);
    expect(isPublicPath("/app/paineis/links")).toBe(false);
  });

  it("⭐ a telemetria apaga o token do caminho, e só ele", () => {
    const token = tokenDoLink(ID);
    expect(urlComCredencial(`https://app.exemplo.invalid/painel/${token}?periodo=30`)).toBe(true);
    const limpa = scrubUrl(`https://app.exemplo.invalid/painel/${token}`);
    expect(limpa).not.toContain(token);
    expect(limpa).toContain("/painel/[TOKEN]");
    // A tela de dentro não é credencial.
    expect(urlComCredencial("https://app.exemplo.invalid/app/paineis/links")).toBe(false);
  });

  it("⭐ os metadados da página pública são fixos: nada da empresa nem número na prévia", () => {
    const fonte = readFileSync(path.join(process.cwd(), "app", "painel", "[token]", "page.tsx"), "utf8");
    // `generateMetadata` leria o link e poderia pôr o nome da empresa no título.
    expect(fonte).not.toMatch(/generateMetadata/);
    const bloco = /export const metadata: Metadata = \{([\s\S]*?)\n\};/.exec(fonte)?.[1] ?? "";
    expect(bloco).toContain('absolute: "Painel de resultados"');
    expect(bloco).toContain('referrer: "no-referrer"');
    expect(bloco).toMatch(/index: false/);
    // Nenhuma expressão no bloco: só texto fixo.
    expect(bloco).not.toMatch(/\$\{|calculados|link\.|empresa/);
  });

  it("a prévia do WhatsApp e afins é reconhecida; o navegador de gente, não", () => {
    expect(ehVisitaDePrevia("WhatsApp/2.23.20.0 A")).toBe(true);
    expect(ehVisitaDePrevia("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")).toBe(true);
    expect(ehVisitaDePrevia("TelegramBot (like TwitterBot)")).toBe(true);
    expect(
      ehVisitaDePrevia(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
    expect(ehVisitaDePrevia(null)).toBe(false);
  });
});
