/**
 * FORK MIA (.91) — QUEM VÊ O "O QUE FALTA" e COMO O RÓTULO DO CLIENTE LÊ O
 * CHECKLIST. Puro: sem banco.
 *
 * O critério sai do estado de conclusão do `/onboarding` do upstream: a
 * empresa que já roda (concluída, sem o segmento que só o passo desta versão
 * grava) não vê bloco novo em lugar nenhum.
 */
import { describe, expect, it } from "vitest";

import type { AreaAvaliada } from "@/lib/mcp-plataforma/checklist/avaliar";
import { montarFrase, rotuloDoCliente } from "@/lib/mcp-plataforma/checklist/rotulo-do-cliente";
import { oQueFaltaAparece } from "@/lib/onboarding/o-que-falta-aparece";

const COM_SEGMENTO = { welcome: { accepted_at: "x", timezone: "America/Sao_Paulo", display_name: "X", segmento: "academia" } };
const SEM_SEGMENTO = { welcome: { accepted_at: "x", timezone: "America/Sao_Paulo", display_name: "X" } };

describe("o critério", () => {
  it("a empresa que já roda (concluída sem o segmento desta versão) não vê, nem o administrador", () => {
    expect(oQueFaltaAparece({ onboardingState: SEM_SEGMENTO, onboardedAt: "2026-09-01", papel: "admin", zerou: false })).toMatchObject({
      aparece: false,
      motivo: "sem_o_passo_a_passo_desta_versao",
    });
    // implantada pela Time: nem `welcome` existe
    expect(oQueFaltaAparece({ onboardingState: {}, onboardedAt: "2026-09-01", papel: "admin", zerou: false }).aparece).toBe(false);
  });

  it("a empresa nova vê no passo a passo e no Início, até zerar", () => {
    expect(oQueFaltaAparece({ onboardingState: {}, onboardedAt: null, papel: "admin", zerou: false })).toMatchObject({
      aparece: true,
      onde: "passo_a_passo",
    });
    expect(oQueFaltaAparece({ onboardingState: COM_SEGMENTO, onboardedAt: "2026-10-25", papel: "manager", zerou: false })).toMatchObject({
      aparece: true,
      onde: "inicio",
    });
    expect(oQueFaltaAparece({ onboardingState: COM_SEGMENTO, onboardedAt: "2026-10-25", papel: "admin", zerou: true })).toMatchObject({
      aparece: false,
      motivo: "ja_zerou",
    });
  });

  it("atendente, somente leitura, demonstração e suporte não veem", () => {
    for (const papel of ["agent", "viewer"] as const) {
      expect(oQueFaltaAparece({ onboardingState: COM_SEGMENTO, onboardedAt: null, papel, zerou: false }).aparece).toBe(false);
    }
    expect(oQueFaltaAparece({ onboardingState: COM_SEGMENTO, onboardedAt: null, papel: "admin", zerou: false, demonstracao: true }).aparece).toBe(false);
    expect(oQueFaltaAparece({ onboardingState: COM_SEGMENTO, onboardedAt: null, papel: "admin", zerou: false, suporte: true }).aparece).toBe(false);
  });
});

function area(chave: string, dados: Record<string, unknown>, extra: Partial<AreaAvaliada> = {}): AreaAvaliada {
  return { area: chave, titulo: chave, situacao: "pronto", pronto: [], falta: [], so_pela_tela: [], dados, ...extra };
}

const NOVA: AreaAvaliada[] = [
  area("empresa", { nome: "Academia Alfa", fuso: "America/Sao_Paulo" }),
  area("primeiros_passos", {
    no_passo_a_passo: false,
    passos: [{ passo: "welcome", situacao: "feito" }],
    segmento: "academia",
    ensaio_feito: false,
    numero_oficial: null,
  }),
  area("canais", { numeros: [] }),
  area("funis", { funis: [{ nome: "Pedidos", etapas: 8, de_e_commerce: true, com_ganho_e_perda: true, padrao: true }] }),
  area("agentes", { agentes: [] }),
  area("followups", { fluxos: [] }),
  area("equipe", { membros: [{}], convites_pendentes: [] }),
  area("conversoes", { conexoes_ligadas: [] }),
  area("plano_e_cobranca", { aplica: true, assinou: false, estado: "trial", teste_ate: "2026-11-08T00:00:00Z", plano: "Profissional" }),
];

describe("o rótulo do cliente", () => {
  it("a empresa nova: as três colunas, o que depende, e o que não se aplica", () => {
    const r = rotuloDoCliente(NOVA, { papel: "admin" });
    const por = Object.fromEntries(r.itens.map((i) => [i.chave, i]));
    expect(r.segmento).toBe("academia");
    expect(por.dados_da_empresa!.coluna).toBe("preenchido");
    expect(por.whatsapp).toMatchObject({ coluna: "preciso_confirmar", quem: "voce" });
    expect(montarFrase(por.agente!.titulo)).toBe("Criar Duda do modelo de academia");
    expect(por.agente).toMatchObject({ coluna: "posso_completar", proposta: "agente" });
    expect(por.funil).toMatchObject({ coluna: "posso_completar", proposta: "funil" });
    expect(montarFrase(por.funil!.titulo)).toBe('Montar o funil "Matrículas"');
    expect(por.followup!.depende_de?.chave).toBe("agente");
    expect(por.ensaio!.depende_de?.chave).toBe("agente");
    expect(por.plano).toMatchObject({ coluna: "preciso_confirmar", quando: "2026-11-08T00:00:00Z" });
    expect(r.nao_se_aplica.map((n) => n.chave)).toEqual(["conversoes", "base_importada"]);
    expect(r.contas).toMatchObject({ total: 8, preenchido: 1, posso_completar: 3, preciso_confirmar: 4, faltam: 7 });
  });

  it("o gestor não vê o plano (é de quem administra), e quem faz o número é quem administra", () => {
    const r = rotuloDoCliente(NOVA, { papel: "manager" });
    expect(r.itens.some((i) => i.chave === "plano")).toBe(false);
    expect(r.nao_se_aplica.some((n) => n.chave === "plano")).toBe(true);
    expect(r.itens.find((i) => i.chave === "whatsapp")?.quem).toBe("quem_administra");
  });

  it("o follow-up aplicado que espera o agente conta como preenchido, \"sai junto com o agente\"", () => {
    const areas = NOVA.map((a) =>
      a.area === "agentes"
        ? area("agentes", { agentes: [{ id: "a1", nome: "Duda · Atendimento", situacao: "rascunho", rascunho_pendente: 1 }] })
        : a.area === "followups"
          ? area("followups", { fluxos: [{ id: "f1", nome: "Aula experimental · marcar a primeira aula", situacao: "rascunho" }] })
          : a,
    );
    const r = rotuloDoCliente(areas, { papel: "admin", followupsQueSaemComOAgente: ["f1"] });
    const fu = r.itens.find((i) => i.chave === "followup")!;
    expect(fu.coluna).toBe("preenchido");
    expect(montarFrase(fu.detalhe)).toContain("sai junto com o agente");
    expect(r.itens.find((i) => i.chave === "agente")).toMatchObject({ coluna: "preciso_confirmar" });
  });

  it("área que o papel não lê fica de fora (não vira \"falta\" mentirosa)", () => {
    const areas = NOVA.map((a) => (a.area === "equipe" ? { ...a, situacao: "nao_medida" as const } : a));
    const r = rotuloDoCliente(areas, { papel: "admin" });
    expect(r.itens.some((i) => i.chave === "equipe")).toBe(false);
    expect(r.nao_medidas).toEqual(["equipe"]);
  });

  it("tudo pronto: faltam zero", () => {
    const areas: AreaAvaliada[] = [
      area("empresa", { nome: "Academia Alfa", fuso: "America/Sao_Paulo" }),
      area("primeiros_passos", { no_passo_a_passo: false, passos: [{ passo: "welcome", situacao: "feito" }], segmento: "academia", ensaio_feito: true }),
      area("canais", { numeros: [{ conectado: true }] }),
      area("funis", { funis: [{ nome: "Matrículas", etapas: 7, de_e_commerce: false, com_ganho_e_perda: true, padrao: true }] }),
      area("agentes", { agentes: [{ id: "a1", nome: "Duda · Atendimento", situacao: "no ar", rascunho_pendente: null }] }),
      area("followups", { fluxos: [{ id: "f1", nome: "Aula experimental", situacao: "publicado" }] }),
      area("equipe", { membros: [{}, {}], convites_pendentes: [] }),
      area("conversoes", { conexoes_ligadas: ["meta_ads"] }),
      area("plano_e_cobranca", { aplica: false, motivo: "isenta" }),
    ];
    const r = rotuloDoCliente(areas, { papel: "admin" });
    expect(r.contas.faltam).toBe(0);
    expect(r.nao_se_aplica.map((n) => n.chave)).toEqual(["plano", "base_importada"]);
  });
});
