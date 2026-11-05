/**
 * FORK MIA (.102) · O RAIO-X DA .101 CONTINUA FUNCIONANDO DEPOIS DA .102.
 *
 * Há raio-X de verdade criado na .101 (um mensal "aguardando", com o link de
 * conexão já mandado ao dono). A .102 só ACRESCENTA: este arquivo prova os
 * quatro pontos que o deixam vivo.
 *
 *  1. O CÓDIGO e os TOKENS da .101 são os mesmos para o mesmo id e versão
 *     (`lib/raio-x/tokens.ts` não mudou: alfabeto, tamanhos, rótulos e o
 *     `raio-x:<rotulo>:v1` do HMAC). Os valores de referência foram calculados
 *     FORA do código do repositório, pelo algoritmo da .101, com um segredo de
 *     teste. Se a derivação mudar, o link que já foi mandado deixa de abrir.
 *  2. A LINHA ANTIGA (sem `fonte`, como o banco em memória a devolve; no
 *     Postgres a 9151 põe o padrão 'conexao', provado na invariante) é tratada
 *     como conexão: a lista, o detalhe e a página pública com o termo v1; e o
 *     aceite dela (agora com nome completo e e-mail) segue o fluxo de três
 *     etapas, para "conectando", com a sessão do leitor.
 *  3. O ACEITE ANTIGO, sem e-mail, é lido sem erro.
 *  4. O ESTADO DE LEITURA ANTIGO (o cursor da .101 em `leitura`) é retomado de
 *     onde parou: a rodada continua da posição gravada, não do começo.
 *
 * Dado fictício (Garagem Modelo Veículos, (31) 90000-xxxx).
 */
import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  process.env.AI_CRED_AES_KEY = "iBc1Z2gYaAH4rEHs1dHQ2dvNQ6t4OfrdE1/Y6OSvtZY=";
  process.env.INTERNAL_SECRET = "segredo-da-compatibilidade-101";
  return {};
});
void env;

import type { ConversaListada, EstadoDaSessao, LeitorDoRaioX, MensagemLida } from "@/lib/channels/raio-x/leitor";
import { acaoVer } from "@/lib/raio-x/acoes";
import { listarRaioX, lerRaioX, registrarAceite, ultimoAceite } from "@/lib/raio-x/banco";
import { rodarOCiclo } from "@/lib/raio-x/ciclo";
import { situacaoPublica } from "@/lib/raio-x/publico";
import {
  codigoDaConexao,
  hashDoCodigo,
  hashDoTokenDoDono,
  marcaDaConversa,
  marcaDaMensagem,
  normalizarCodigo,
  tokenDoDono,
} from "@/lib/raio-x/tokens";
import { bancoEmMemoria, type Linha, type RpcDeMentira } from "@/tests/helpers/banco-em-memoria";

const RX = "e9150e90-2222-4000-8000-000000000101";
const LINK = "e9150e90-4444-4000-8000-000000000101";
const T0 = Date.parse("2026-11-05T15:00:00Z");
const DIA = 86_400_000;
const CHAT_A = "5531900000002@c.us";
const CHAT_B = "5531900000003@c.us";

/** Uma linha de `mia_raio_x` como a .101 gravou: SEM `fonte` e SEM `primeira_conversa_em`. */
function linhaDa101(extra: Partial<Linha> = {}): Linha {
  return {
    id: RX,
    empresa: "Garagem Modelo Veículos",
    segmento: "revenda_de_veiculos",
    whatsapp: "5531900001101",
    responsavel_nome: "Ricardo Exemplo",
    responsavel_contato: null,
    quem_atende: "humano",
    periodo_dias: 90,
    tipo: "mensal",
    abre: "08:00:00",
    fecha: "18:00:00",
    sabado_ate: "13:00:00",
    organization_id: null,
    teto_centavos: 4000,
    situacao: "aguardando",
    conexao_codigo_hash: hashDoCodigo(codigoDaConexao(RX, 1)),
    conexao_versao: 1,
    conexao_expira_em: "2026-11-07T15:00:00.000Z",
    sessao: null,
    conectado_em: null,
    numero_conectado: null,
    ciclo: 1,
    periodo_inicio: null,
    periodo_fim: null,
    competencia: null,
    leitura: {},
    leitura_concluida_em: null,
    analise: {},
    trava_ate: null,
    ultimo_relatorio_em: null,
    desconectar_em: null,
    desconectado_em: null,
    apagar_conversas_em: null,
    conversas_apagadas_em: null,
    encerrado_em: null,
    criado_por: null,
    criado_via: "tela",
    created_at: "2026-11-04T18:00:00.000Z",
    updated_at: "2026-11-04T18:00:00.000Z",
    ...extra,
  };
}

describe("1. o código e os tokens da .101 não mudaram", () => {
  it("o mesmo id e a mesma versão dão o mesmo código, o mesmo hash e as mesmas marcas", () => {
    // Calculados fora do repositório, pelo algoritmo da .101, com o segredo deste teste.
    expect(codigoDaConexao(RX, 1)).toBe("YME0GKVR");
    expect(codigoDaConexao(RX, 3)).toBe("WEF91A4Z");
    expect(hashDoCodigo("YME0GKVR")).toBe("ecda91340bb6ee7cc35981d96c01a371758d0a3daeb06b5c6c3f6294fdcba551");
    expect(tokenDoDono(LINK)).toBe("xnyxy8sfde07avf12ja0gvjv");
    expect(hashDoTokenDoDono("xnyxy8sfde07avf12ja0gvjv")).toBe("160761db051dcd8ce75de96295fc755809c320c8284063636aa0bf78df09b4c2");
    expect(marcaDaConversa(RX, CHAT_A)).toBe("2504d1b0987404354bc7a27e1cdadff018d841081d6493438a5411400167aa7a");
    expect(marcaDaMensagem(RX, "false_A_1")).toBe("8e1f3aaf4049549f6f3b139fbe989ca7b964c7e22e9afb7b0417b72bbb74926f");
    // O link mandado ao dono, em minúsculas ou com hífen, ainda resolve.
    expect(normalizarCodigo("yme0-gkvr")).toBe("YME0GKVR");
  });
});

describe("2. a linha da .101 sem fonte é conexão, e segue as três etapas", () => {
  it("a lista, o detalhe e a página pública tratam como conexão, com o termo v1", async () => {
    const banco = bancoEmMemoria({ mia_raio_x: [linhaDa101()] });
    const [naLista] = await listarRaioX(banco.cliente as never, new Date(T0));
    expect(naLista).toMatchObject({ fonte: "conexao", numeros: 0, tipo: "mensal", situacao: "aguardando", linkVivo: true });
    const detalhe = await acaoVer(banco.cliente as never, RX);
    expect(detalhe?.raioX).toMatchObject({ fonte: "conexao", numeros: [] });
    expect(detalhe?.conexao?.link).toMatch(/\/raio-x\/YME0GKVR$/);
    const r = await lerRaioX(banco.cliente as never, RX);
    const publica = situacaoPublica(r!, new Date(T0));
    expect(publica).toMatchObject({ fonte: "conexao", etapa: "termo", numeros: [], periodo: null });
    expect(publica.termo).toMatch(/^TERMO DE AUTORIZAÇÃO · RAIO-X DO ATENDIMENTO · versão 1/);
  });

  it("o aceite da .102 (nome completo e e-mail) leva a linha antiga para \"conectando\", com a sessão do leitor", async () => {
    const banco = bancoEmMemoria({ mia_raio_x: [linhaDa101()] });
    const r = await lerRaioX(banco.cliente as never, RX);
    const aceite = await registrarAceite(banco.cliente as never, r!, { nome: "Ricardo Exemplo", email: "ricardo@garagemmodelo.com.br" });
    expect(aceite).toMatchObject({ termoVersao: "v1", sessao: "raiox_e9150e902222400080000000" });
    expect(banco.db.mia_raio_x![0]).toMatchObject({ situacao: "conectando", sessao: "raiox_e9150e902222400080000000" });
    expect(banco.db.mia_raio_x_aceites![0]).toMatchObject({ nome: "Ricardo Exemplo", email: "ricardo@garagemmodelo.com.br", termo_versao: "v1" });
    expect(String(banco.db.mia_raio_x_aceites![0]!.termo_texto)).toContain("acompanhamento mensal");
  });
});

describe("3. o aceite antigo, sem e-mail", () => {
  it("é lido sem erro, com o e-mail nulo", async () => {
    const banco = bancoEmMemoria({
      mia_raio_x: [linhaDa101({ situacao: "conectando", sessao: "raiox_e9150e902222400080000000" })],
      mia_raio_x_aceites: [
        { raio_x_id: RX, nome: "Ricardo", termo_versao: "v1", termo_texto: "TERMO v1", termo_hash: "c".repeat(64), aceito_em: "2026-11-04T18:30:00.000Z" },
      ],
    });
    const a = await ultimoAceite(banco.cliente as never, RX);
    expect(a).toMatchObject({ nome: "Ricardo", termo_versao: "v1" });
    expect(a?.email ?? null).toBeNull();
    const detalhe = await acaoVer(banco.cliente as never, RX);
    expect(detalhe?.aceite?.nome).toBe("Ricardo");
  });
});

describe("4. o estado de leitura da .101 é retomado de onde parou", () => {
  it("a rodada continua da posição gravada no cursor, e a conversa já lida não é relida", async () => {
    const desde = T0 - 90 * DIA;
    const lidaA = Date.parse("2026-11-01T13:05:00Z");
    const banco = bancoEmMemoria(
      {
        mia_raio_x: [
          linhaDa101({
            situacao: "lendo",
            tipo: "unico",
            sessao: "raiox_e9150e902222400080000000",
            conectado_em: new Date(T0 - 2 * 3_600_000).toISOString(),
            periodo_inicio: new Date(desde).toISOString(),
            // O cursor como a .101 o grava: posição 1, a conversa da posição 0 já lida.
            leitura: { fase: "lendo", desde, ate: null, indice: 1, offset: 0, total: 2, conversas_lidas: 1, mensagens_lidas: 2 },
          }),
        ],
        mia_raio_x_conversas: [
          { id: "conversa-1", raio_x_id: RX, chat_marca: marcaDaConversa(RX, CHAT_A), numero_ordem: 1, ultima_em: new Date(lidaA).toISOString(), analise_ciclo: null, fora_do_teto: false },
        ],
      },
      { fn_mia_raio_x_conversa: rpcConversa },
    );
    const chamadas: string[] = [];
    const lista: ConversaListada[] = [
      { chatId: CHAT_A, ultimaEm: lidaA, posicao: 0 },
      { chatId: CHAT_B, ultimaEm: Date.parse("2026-11-02T12:00:00Z"), posicao: 1 },
    ];
    const mensagens: Record<string, MensagemLida[]> = {
      [CHAT_B]: [{ id: "false_B_1", daLoja: false, em: Date.parse("2026-11-02T12:00:00Z"), tipo: "texto", texto: "Vocês financiam sem entrada?", segundos: null, anuncio: null, nome: null }],
    };
    const leitor: LeitorDoRaioX = {
      async estado(): Promise<EstadoDaSessao> {
        return { estado: "conectado", numero: "5531900001101" };
      },
      async preparar() {
        return { estado: "conectado", numero: "5531900001101" };
      },
      async pedirCodigo() {
        return "K7PQ-2M9X";
      },
      async qr() {
        return null;
      },
      async paginaDeConversas(_s, { limit, offset }) {
        chamadas.push(`conversas:${offset}`);
        const bruto = lista.slice(offset, offset + limit);
        return { conversas: bruto, lidas: bruto.length };
      },
      async paginaDeMensagens(_s, chatId, { limit, offset }) {
        chamadas.push(`mensagens:${chatId}:${offset}`);
        const pagina = (mensagens[chatId] ?? []).slice(offset, offset + limit);
        return { mensagens: pagina, lidas: pagina.length };
      },
      async baixarAudio() {
        return null;
      },
      async desconectar() {
        chamadas.push("desconectar");
      },
    };
    const resumo = await rodarOCiclo({ admin: banco.cliente as never, leitor, prazo: T0 + 10 * 60_000, agora: () => T0, modelo: null, chamar: null, transcritor: null });
    // Começou da posição 1, não do zero.
    expect(chamadas[0]).toBe("conversas:1");
    expect(chamadas).toContain(`mensagens:${CHAT_B}:0`);
    // A conversa da posição 0 já tinha sido lida: nem na conferência ela é relida.
    expect(chamadas).not.toContain(`mensagens:${CHAT_A}:0`);
    expect(resumo.efeitos).toContainEqual(expect.objectContaining({ acao: "raio_x.leitura_concluida", conversas: 2 }));
    expect(banco.db.mia_raio_x![0]!.situacao).toBe("analisando");
    expect(chamadas).not.toContain("desconectar");
  });
});

const rpcConversa: RpcDeMentira = (args, db) => {
  const t = (db.mia_raio_x_conversas ??= []);
  const achada = t.find((c) => c.raio_x_id === args.p_raio_x && c.chat_marca === args.p_marca);
  if (achada) return { data: [{ id: achada.id, numero_ordem: achada.numero_ordem }], error: null };
  const numero = Math.max(0, ...t.filter((c) => c.raio_x_id === args.p_raio_x).map((c) => Number(c.numero_ordem))) + 1;
  t.push({ id: `conversa-${numero}`, raio_x_id: args.p_raio_x, chat_marca: args.p_marca, referencia: args.p_referencia, numero_ordem: numero, anuncio: false, ultima_em: args.p_ultima_em, analise_ciclo: null, fora_do_teto: false });
  return { data: [{ id: `conversa-${numero}`, numero_ordem: numero }], error: null };
};
