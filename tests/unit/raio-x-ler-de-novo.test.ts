/**
 * FORK MIA (.105) · LER DE NOVO, E A SINCRONIA QUE NÃO PARA EM ZERO.
 *
 * O primeiro raio-X real pela conexão (05/11/2026) conectou, contou 0 conversas
 * por 5 minutos e fechou a leitura: o relatório saiu vazio, com o WhatsApp ainda
 * conectado. Três peças, um `describe` cada:
 *
 *  1. a SINCRONIA: contagem parada em zero não é sincronia pronta (espera os 40
 *     minutos); parada em um número, continua valendo os 5;
 *  2. LER DE NOVO (`acaoLerDeNovo`): só raio-X pronto, pela conexão, conectado e
 *     sem relatório revisado no período; o rascunho do período sai e a leitura
 *     volta ao começo;
 *  3. o APARELHO AGORA (`acaoVerAparelho`): a etapa e quantas conversas o leitor
 *     mostra, sem abrir nenhuma.
 *
 * Dados fictícios.
 */
import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  process.env.AI_CRED_AES_KEY = "iBc1Z2gYaAH4rEHs1dHQ2dvNQ6t4OfrdE1/Y6OSvtZY=";
  process.env.INTERNAL_SECRET = "segredo-do-teste-do-raio-x";
  return {};
});
void env;

import type { ConversaListada, EstadoDaSessao, LeitorDoRaioX } from "@/lib/channels/raio-x/leitor";
import { acaoLerDeNovo, acaoVerAparelho } from "@/lib/raio-x/acoes";
import type { LinhaDoRaioX } from "@/lib/raio-x/banco";
import { ESPERA_MAXIMA_DA_SINCRONIA_MS, ESTABILIZA_EM_MS, estadoInicial, rodadaDeLeitura, sincroniaEstavel } from "@/lib/raio-x/leitura";
import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

const RX = "e9150e90-2222-4000-8000-0000000105c1";
const T0 = Date.parse("2026-11-05T20:42:00Z");
const MIN = 60_000;
const DIA = 86_400_000;
const INICIO = new Date(T0 - 30 * DIA).toISOString();

function raioX(extra: Partial<Linha> = {}): Linha {
  return {
    id: RX,
    fonte: "conexao",
    primeira_conversa_em: null,
    empresa: "Clínica Modelo",
    segmento: "clinica_de_estetica",
    whatsapp: "5531900001105",
    responsavel_nome: "Ricardo Exemplo",
    responsavel_contato: null,
    quem_atende: "humano",
    periodo_dias: 30,
    tipo: "unico",
    abre: "08:00:00",
    fecha: "18:00:00",
    sabado_ate: null,
    organization_id: null,
    teto_centavos: 2000,
    situacao: "pronto",
    conexao_versao: 1,
    conexao_expira_em: null,
    sessao: "raiox_e9150e9022224000800105",
    conectado_em: new Date(T0).toISOString(),
    numero_conectado: "553100001105",
    ciclo: 1,
    periodo_inicio: INICIO,
    periodo_fim: new Date(T0 + 7 * MIN).toISOString(),
    competencia: null,
    leitura: { fase: "concluida", desde: Date.parse(INICIO), ate: null, indice: 0, offset: 0, total: 0, conversas_lidas: 0, mensagens_lidas: 0 },
    leitura_concluida_em: new Date(T0 + 7 * MIN).toISOString(),
    analise: {},
    trava_ate: null,
    ultimo_relatorio_em: new Date(T0 + 8 * MIN).toISOString(),
    desconectar_em: new Date(T0 + 7 * DIA).toISOString(),
    desconectado_em: null,
    apagar_conversas_em: new Date(T0 + 30 * DIA).toISOString(),
    conversas_apagadas_em: null,
    encerrado_em: null,
    criado_por: null,
    criado_via: "tela",
    created_at: new Date(T0 - 2 * MIN).toISOString(),
    updated_at: new Date(T0 + 8 * MIN).toISOString(),
    ...extra,
  };
}

function relatorio(situacao: "rascunho" | "revisado", periodoInicio = INICIO): Linha {
  return {
    id: `rel-${situacao}-${periodoInicio.slice(0, 10)}`,
    raio_x_id: RX,
    sequencia: 1,
    periodo_inicio: periodoInicio,
    periodo_fim: new Date(T0 + 7 * MIN).toISOString(),
    competencia: null,
    situacao,
    criterios_versao: "v1",
    dados: {},
    comparacao: null,
    anterior_id: null,
    parcial: false,
    conversas: 0,
    custo_usd_centavos: 0,
    custo_centavos: 0,
    notas_da_time: null,
    revisado_por: null,
    revisado_em: situacao === "revisado" ? new Date(T0 + 9 * MIN).toISOString() : null,
    created_at: new Date(T0 + 8 * MIN).toISOString(),
  };
}

/** Um leitor de mentira com N conversas individuais na lista e a etapa pedida. */
function leitorDuble(conversas: number, estado: EstadoDaSessao["estado"] = "conectado") {
  const lista: ConversaListada[] = Array.from({ length: conversas }, (_, i) => ({
    chatId: `55319000${String(10000 + i).slice(-5)}@c.us`,
    ultimaEm: T0 - DIA,
    posicao: i,
  }));
  const pedidos: string[] = [];
  const leitor: LeitorDoRaioX = {
    async estado() {
      pedidos.push("estado");
      return { estado, numero: estado === "conectado" ? "553100001105" : null };
    },
    async preparar() {
      throw new Error("ler de novo não prepara sessão");
    },
    async pedirCodigo() {
      throw new Error("ler de novo não pede código");
    },
    async qr() {
      throw new Error("ler de novo não pede QR");
    },
    async paginaDeConversas(_s, { limit, offset }) {
      pedidos.push(`conversas:${offset}`);
      const bruto = lista.slice(offset, offset + limit);
      return { conversas: bruto, lidas: bruto.length };
    },
    async paginaDeMensagens() {
      throw new Error("ver o aparelho não abre conversa");
    },
    async baixarAudio() {
      throw new Error("não baixa áudio");
    },
    async desconectar() {
      throw new Error("ler de novo não desconecta");
    },
  };
  return { leitor, pedidos };
}

describe("1. a sincronia não para em zero", () => {
  const conectado = T0;
  it("zero parado por 5 minutos NÃO é sincronia pronta", () => {
    const sinc = { conversas: 0, estavel_desde: new Date(conectado + MIN).toISOString() };
    expect(sincroniaEstavel(sinc, conectado, conectado + 7 * MIN)).toBe(false);
    expect(sincroniaEstavel(sinc, conectado, conectado + 39 * MIN)).toBe(false);
  });

  it("zero até a espera máxima: aí a leitura começa (a conta pode não ter conversa mesmo)", () => {
    const sinc = { conversas: 0, estavel_desde: new Date(conectado).toISOString() };
    expect(sincroniaEstavel(sinc, conectado, conectado + ESPERA_MAXIMA_DA_SINCRONIA_MS)).toBe(true);
  });

  it("CONTROLE: um número parado por 5 minutos continua valendo", () => {
    const sinc = { conversas: 42, estavel_desde: new Date(conectado + 2 * MIN).toISOString() };
    expect(sincroniaEstavel(sinc, conectado, conectado + 2 * MIN + ESTABILIZA_EM_MS)).toBe(true);
  });

  it("a rodada com a lista vazia 7 minutos depois de conectar segue sincronizando, sem concluir", async () => {
    const { leitor } = leitorDuble(0);
    const r = raioX({ situacao: "lendo", conectado_em: new Date(T0).toISOString(), periodo_fim: null });
    const e = { ...estadoInicial(new Date(INICIO), null, "sincronizando"), sinc: { conversas: 0, estavel_desde: new Date(T0 + MIN).toISOString(), contagens: 6 } };
    const rodada = await rodadaDeLeitura(
      { admin: bancoEmMemoria().cliente as never, leitor, raioX: r as unknown as LinhaDoRaioX, prazo: T0 + 8 * MIN, agora: () => T0 + 7 * MIN },
      e,
    );
    expect(rodada.concluiu).toBe(false);
    expect(rodada.estado.fase).toBe("sincronizando");
  });
});

describe("2. ler de novo", () => {
  it("o raio-X pronto e conectado volta a ler; o rascunho do período sai", async () => {
    const banco = bancoEmMemoria({ mia_raio_x: [raioX()], mia_raio_x_relatorios: [relatorio("rascunho")] });
    const { leitor } = leitorDuble(12);
    const r = await acaoLerDeNovo(banco.cliente as never, RX, leitor);
    expect(r).toEqual({ ok: true, descartados: 1 });
    const linha = banco.db.mia_raio_x![0]!;
    expect(linha.situacao).toBe("lendo");
    expect(linha.periodo_fim).toBeNull();
    expect(linha.leitura_concluida_em).toBeNull();
    expect((linha.leitura as { fase: string; desde: number; conversas_lidas: number }).fase).toBe("sincronizando");
    expect((linha.leitura as { desde: number }).desde).toBe(Date.parse(INICIO));
    expect(banco.db.mia_raio_x_relatorios).toEqual([]);
  });

  it("no mês novo do mensal, a janela do mês fica e a leitura começa direto", async () => {
    const mesInicio = "2026-11-01T03:00:00.000Z";
    const mesFim = "2026-12-01T03:00:00.000Z";
    const banco = bancoEmMemoria({
      mia_raio_x: [raioX({ tipo: "mensal", ciclo: 2, periodo_inicio: mesInicio, periodo_fim: mesFim, competencia: "2026-11-01" })],
      mia_raio_x_relatorios: [relatorio("rascunho", mesInicio), relatorio("revisado")],
    });
    const r = await acaoLerDeNovo(banco.cliente as never, RX, leitorDuble(3).leitor);
    expect(r).toEqual({ ok: true, descartados: 1 });
    const linha = banco.db.mia_raio_x![0]!;
    expect(linha.periodo_fim).toBe(mesFim);
    expect(linha.leitura).toMatchObject({ fase: "lendo", desde: Date.parse(mesInicio), ate: Date.parse(mesFim) });
    // O relatório revisado do mês anterior fica.
    expect(banco.db.mia_raio_x_relatorios!.map((x) => x.situacao)).toEqual(["revisado"]);
  });

  it.each([
    ["ainda lendo", { situacao: "lendo" }, "nao_esta_pronto"],
    ["encerrado", { situacao: "encerrado" }, "encerrado"],
    ["do cliente ativo", { fonte: "conversas_da_mia", sessao: null }, "do_cliente_ativo"],
    ["desconectado", { desconectado_em: new Date(T0 + DIA).toISOString() }, "desconectado"],
    ["sem sessão", { sessao: null }, "desconectado"],
  ])("recusa o raio-X %s", async (_nome, extra, motivo) => {
    const banco = bancoEmMemoria({ mia_raio_x: [raioX(extra)], mia_raio_x_relatorios: [relatorio("rascunho")] });
    const r = await acaoLerDeNovo(banco.cliente as never, RX, leitorDuble(12).leitor);
    expect(r).toEqual({ ok: false, motivo });
    expect(banco.db.mia_raio_x![0]!.situacao).toBe((extra as { situacao?: string }).situacao ?? "pronto");
    expect(banco.db.mia_raio_x_relatorios).toHaveLength(1);
  });

  it("recusa quando o aparelho saiu (o leitor não o vê conectado)", async () => {
    const banco = bancoEmMemoria({ mia_raio_x: [raioX()], mia_raio_x_relatorios: [relatorio("rascunho")] });
    expect(await acaoLerDeNovo(banco.cliente as never, RX, leitorDuble(0, "esperando_pareamento").leitor)).toEqual({ ok: false, motivo: "desconectado" });
    expect(await acaoLerDeNovo(banco.cliente as never, RX, null)).toEqual({ ok: false, motivo: "leitor_indisponivel" });
    expect(banco.db.mia_raio_x![0]!.situacao).toBe("pronto");
  });

  it("recusa quando o relatório do período já foi revisado (pode ter ido ao dono)", async () => {
    const banco = bancoEmMemoria({ mia_raio_x: [raioX()], mia_raio_x_relatorios: [relatorio("revisado")] });
    expect(await acaoLerDeNovo(banco.cliente as never, RX, leitorDuble(12).leitor)).toEqual({ ok: false, motivo: "ja_revisado" });
    expect(banco.db.mia_raio_x![0]!.situacao).toBe("pronto");
  });
});

describe("3. o aparelho agora", () => {
  it("conta as conversas que o leitor mostra, página a página, sem abrir nenhuma", async () => {
    const banco = bancoEmMemoria({ mia_raio_x: [raioX()] });
    const { leitor, pedidos } = leitorDuble(230);
    expect(await acaoVerAparelho(banco.cliente as never, RX, leitor)).toEqual({ estado: "conectado", conversas: 230, mais: false });
    expect(pedidos).toEqual(["estado", "conversas:0", "conversas:100", "conversas:200"]);
  });

  it("para em mil e avisa que há mais", async () => {
    const banco = bancoEmMemoria({ mia_raio_x: [raioX()] });
    expect(await acaoVerAparelho(banco.cliente as never, RX, leitorDuble(1500).leitor)).toEqual({ estado: "conectado", conversas: 1000, mais: true });
  });

  it("zero é zero: o histórico não chegou ao leitor", async () => {
    const banco = bancoEmMemoria({ mia_raio_x: [raioX()] });
    expect(await acaoVerAparelho(banco.cliente as never, RX, leitorDuble(0).leitor)).toEqual({ estado: "conectado", conversas: 0, mais: false });
  });

  it("sem conexão não pergunta nada; aparelho fora diz a etapa sem contar", async () => {
    const desconectado = bancoEmMemoria({ mia_raio_x: [raioX({ desconectado_em: new Date(T0 + DIA).toISOString() })] });
    expect(await acaoVerAparelho(desconectado.cliente as never, RX, leitorDuble(5).leitor)).toBeNull();
    const daConta = bancoEmMemoria({ mia_raio_x: [raioX({ fonte: "conversas_da_mia", sessao: null })] });
    expect(await acaoVerAparelho(daConta.cliente as never, RX, leitorDuble(5).leitor)).toBeNull();
    const fora = bancoEmMemoria({ mia_raio_x: [raioX()] });
    expect(await acaoVerAparelho(fora.cliente as never, RX, leitorDuble(5, "esperando_pareamento").leitor)).toEqual({
      estado: "esperando_pareamento",
      conversas: null,
      mais: false,
    });
  });
});
