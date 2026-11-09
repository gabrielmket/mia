/**
 * FORK MIA (.107) · O RAIO-X GRÁTIS POR CADASTRO, de ponta a ponta, com as
 * tabelas num banco em memória e o leitor, o e-mail, a fonte do CRM e o Asaas
 * dublados. Nenhum contêiner, nenhum e-mail, nenhuma cobrança de verdade.
 *
 *  1. o CADASTRO: a conta, o raio-X grátis (conexão, único, 30 dias, R$ 10,
 *     origem cadastro), o aceite v1 na hora, o leitor preparado, o LEAD pela
 *     chamada interna da fonte com os campos certos e o e-mail "começou";
 *  2. a GRÁTIS: uma por número (as duas grafias do nono dígito) e uma por conta;
 *     a que fechou sem histórico não conta; o lead é atualizado mesmo assim;
 *  3. sem `RAIO_X_FONTE_DO_CRM` o cadastro NÃO quebra;
 *  4. o CÓDIGO de acesso no banco: só o hash, 15 minutos, 5 tentativas, e a
 *     resposta igual para e-mail que não existe;
 *  5. a ÁREA só vê o que é da conta;
 *  6. o CICLO publica direto o do cadastro e NÃO o da Time; 0 conversas num
 *     grátis não gera relatório e não gasta a grátis;
 *  7. a NOVA ANÁLISE: sem preço vira interesse; com preço, a cobrança no Asaas;
 *     pago cria o raio-X novo; cancelado marca o pedido.
 *
 * Dados fictícios (Garagem Modelo Veículos, Ricardo Exemplo, 5531900001xxx).
 */
import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  process.env.AI_CRED_AES_KEY = "iBc1Z2gYaAH4rEHs1dHQ2dvNQ6t4OfrdE1/Y6OSvtZY=";
  process.env.INTERNAL_SECRET = "segredo-do-teste-do-raio-x";
  return {};
});
void env;

vi.mock("@/lib/branding/saida", () => ({
  marcaDaSaida: async () => ({ nome: "MIA", logoUrl: null, accent: "#0a7a57", accentFg: "#ffffff" }),
  NEUTROS_DE_SAIDA: { texto: "#111513", suave: "#606b65", fundo: "#f3f6f4", linha: "#dce3de" },
}));

import type { LeitorDoRaioX } from "@/lib/channels/raio-x/leitor";
import { TENTATIVAS_DO_CODIGO } from "@/lib/raio-x/acesso";
import { raioXDaContaPeloId } from "@/lib/raio-x/area";
import { cadastrar } from "@/lib/raio-x/cadastrar";
import { validarCadastro, type CadastroValido } from "@/lib/raio-x/cadastro";
import { rodarOCiclo } from "@/lib/raio-x/ciclo";
import { conferirCodigoDeAcesso, criarCodigoDeAcesso } from "@/lib/raio-x/contas";
import type { EnviarEmail } from "@/lib/raio-x/emails";
import type { ProcessarCaptacao } from "@/lib/raio-x/lead-da-time";
import { pedirNovaAnalise, relerPedidosDaConta, type LinhaDoPedido } from "@/lib/raio-x/pedidos";
import { asaasFalso, CHAVE_DE_TESTE } from "@/tests/helpers/asaas-falso";
import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

const T0 = new Date("2026-11-06T15:00:00Z");
const MIN = 60_000;
const DIA = 86_400_000;
const ORG_TIME = "e9152e90-0000-4000-8000-0000000000aa";
const FONTE = "e9152e90-0000-4000-8000-0000000000bb";
const LEAD = "e9152e90-0000-4000-8000-0000000000cc";
const TOKEN_DA_FONTE = "token-da-fonte-de-teste-raio-x";

function dados(extra: Record<string, unknown> = {}): CadastroValido {
  const r = validarCadastro({
    nome: "Ricardo Exemplo",
    email: "ricardo@garagemmodelo.com.br",
    telefone: "(31) 90000-2202",
    whatsapp: "(31) 90000-1101",
    empresa: "Garagem Modelo Veículos",
    segmento: "revenda_de_veiculos",
    quem_atende: "humano",
    abre: "08:00",
    fecha: "18:00",
    sabado_ate: "13:00",
    aceite: "sim",
    utm_source: "instagram",
    utm_campaign: "raio-x-novembro",
    fbclid: "fbclid-de-teste",
    origem: "site",
    ...extra,
  });
  if (!r.ok) throw new Error(`cadastro de teste inválido: ${r.campos.join(",")}`);
  return r.valor;
}

function mundo(tabelas: Record<string, Linha[]> = {}) {
  const banco = bancoEmMemoria({
    webhook_sources: [{ id: FONTE, organization_id: ORG_TIME, path_token: TOKEN_DA_FONTE, secret_encrypted: null, is_active: true }],
    ...tabelas,
  });
  const emails: Array<{ to: string; subject: string; text: string }> = [];
  const enviarEmail: EnviarEmail = async (a) => {
    emails.push({ to: a.to, subject: a.subject, text: a.text });
    return { ok: true };
  };
  const capturas: Array<{ token: string; corpo: Record<string, string>; headers: Record<string, string> }> = [];
  const processar: ProcessarCaptacao = async (token, corpo, headers) => {
    capturas.push({ token, corpo: JSON.parse(corpo) as Record<string, string>, headers });
    return new Response(JSON.stringify({ data: { lead_id: LEAD } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const leitorPedidos: string[] = [];
  const leitor = {
    async preparar(sessao: string) {
      leitorPedidos.push(`preparar:${sessao}`);
      return { estado: "esperando_pareamento", numero: null };
    },
    async estado() {
      return { estado: "esperando_pareamento", numero: null };
    },
    async desconectar(sessao: string) {
      leitorPedidos.push(`desconectar:${sessao}`);
    },
  } as unknown as LeitorDoRaioX;
  const lead = { fonteId: FONTE, processar };
  return { banco, emails, capturas, leitor, leitorPedidos, lead, deps: { leitor, enviarEmail, lead, agora: T0 } };
}

const admin = (m: ReturnType<typeof mundo>) => m.banco.cliente as never;

// ─── 1. o cadastro ──────────────────────────────────────────────────────────

describe("o cadastro do raio-X grátis", () => {
  it("cria a conta, o raio-X grátis, o aceite v1 e prepara o leitor", async () => {
    const m = mundo();
    const r = await cadastrar(admin(m), dados(), m.deps);
    expect(r.tipo).toBe("criado");
    if (r.tipo !== "criado") return;
    expect(m.banco.db.mia_raio_x_contas).toHaveLength(1);
    expect(m.banco.db.mia_raio_x_contas![0]).toMatchObject({ email: "ricardo@garagemmodelo.com.br", nome: "Ricardo Exemplo", telefone: "5531900002202" });
    const rx = m.banco.db.mia_raio_x![0]!;
    expect(rx).toMatchObject({
      fonte: "conexao",
      origem: "cadastro",
      gratis: true,
      conta_id: r.conta.id,
      whatsapp: "5531900001101",
      tipo: "unico",
      periodo_dias: 30,
      teto_centavos: 1000,
      criado_via: "cadastro",
      // O aceite foi no formulário: a página de conexão abre na etapa de conectar.
      situacao: "conectando",
    });
    expect(String(rx.sessao)).toMatch(/^raiox_[0-9a-f]{24}$/);
    expect(m.leitorPedidos).toEqual([`preparar:${rx.sessao}`]);
    const aceite = m.banco.db.mia_raio_x_aceites![0]!;
    expect(aceite).toMatchObject({ raio_x_id: rx.id, nome: "Ricardo Exemplo", email: "ricardo@garagemmodelo.com.br", termo_versao: "v1" });
    expect(String(aceite.termo_texto)).toContain("Garagem Modelo Veículos");
    expect(String(aceite.termo_texto)).toContain("últimos 30 dias");
    expect(r.link).toMatch(/\/raio-x\/[0-9A-Z]{8}$/);
  });

  it("⭐ o lead: a chamada interna da fonte da Time, com os campos certos", async () => {
    const m = mundo();
    const r = await cadastrar(admin(m), dados(), m.deps);
    if (r.tipo !== "criado") throw new Error("não criou");
    expect(m.capturas).toHaveLength(1);
    const { token, corpo, headers } = m.capturas[0]!;
    expect(token).toBe(TOKEN_DA_FONTE);
    expect(headers["content-type"]).toBe("application/json");
    expect(corpo).toMatchObject({
      external_id: `raiox-conta-${r.conta.id}`,
      nome: "Ricardo Exemplo",
      // O WhatsApp da PESSOA, não o analisado.
      telefone: "+5531900002202",
      email: "ricardo@garagemmodelo.com.br",
      empresa: "Garagem Modelo Veículos",
      segmento: "Revenda de veículos",
      whatsapp_analisado: "(31) 90000-1101",
      origem: "raio-x-gratis",
      origem_do_site: "site",
      utm_source: "instagram",
      utm_campaign: "raio-x-novembro",
      fbclid: "fbclid-de-teste",
    });
    // O número analisado nunca vai num apelido de telefone.
    expect(corpo.whatsapp).toBeUndefined();
    expect(m.banco.db.mia_raio_x_contas![0]).toMatchObject({ crm_lead_id: LEAD, crm_erro: null });
    expect(r.lead).toEqual({ ok: true, leadId: LEAD, organizationId: ORG_TIME });
  });

  it("o e-mail \"seu Raio-X começou\" leva o link de conexão e como entrar na área", async () => {
    const m = mundo();
    const r = await cadastrar(admin(m), dados(), m.deps);
    if (r.tipo !== "criado") throw new Error("não criou");
    expect(m.emails).toHaveLength(1);
    expect(m.emails[0]!.to).toBe("ricardo@garagemmodelo.com.br");
    expect(m.emails[0]!.subject).toContain("Seu Raio-X do atendimento começou");
    expect(m.emails[0]!.text).toContain(r.link);
    expect(m.emails[0]!.text).toContain("/raio-x/entrar");
    expect(m.emails[0]!.text).not.toMatch(/—|\bIA\b/);
  });

  it("sem RAIO_X_FONTE_DO_CRM o cadastro NÃO quebra: o raio-X nasce e a conta fica marcada", async () => {
    const m = mundo();
    const r = await cadastrar(admin(m), dados(), { ...m.deps, lead: { fonteId: null, processar: m.lead.processar } });
    expect(r.tipo).toBe("criado");
    if (r.tipo !== "criado") return;
    expect(r.lead).toEqual({ ok: false, motivo: "sem_fonte" });
    expect(m.capturas).toHaveLength(0);
    expect(m.banco.db.mia_raio_x).toHaveLength(1);
    expect(m.banco.db.mia_raio_x_contas![0]).toMatchObject({ crm_erro: "sem_fonte" });
    expect(m.emails).toHaveLength(1);
  });

  it("a fonte que a Time desligou também não quebra o cadastro", async () => {
    const m = mundo({ webhook_sources: [{ id: FONTE, organization_id: ORG_TIME, path_token: TOKEN_DA_FONTE, secret_encrypted: null, is_active: false }] });
    const r = await cadastrar(admin(m), dados(), m.deps);
    expect(r.tipo === "criado" && r.lead).toEqual({ ok: false, motivo: "fonte_inexistente" });
  });
});

// ─── 2. a grátis ────────────────────────────────────────────────────────────

describe("uma grátis por número e por conta", () => {
  it("⭐ o mesmo celular na OUTRA grafia do nono dígito já usou a grátis, e o lead é atualizado mesmo assim", async () => {
    const m = mundo();
    // 5531990001106 (com o 9) e 553190001106 (sem): o mesmo celular.
    const um = await cadastrar(admin(m), dados({ whatsapp: "(31) 99000-1106" }), m.deps);
    expect(um.tipo).toBe("criado");
    const dois = await cadastrar(admin(m), dados({ whatsapp: "(31) 9000-1106", email: "outra@garagemmodelo.com.br" }), m.deps);
    expect(dois.tipo).toBe("ja_usou");
    expect(m.banco.db.mia_raio_x).toHaveLength(1);
    // O lead da segunda pessoa foi ao CRM (cadastro) e recebeu a nota e o campo.
    expect(m.capturas).toHaveLength(2);
    expect(m.banco.chamadasRpc.filter((c) => c.nome === "fn_lead_anotar_campos")).toHaveLength(1);
    expect(m.banco.chamadasRpc.find((c) => c.nome === "fn_lead_anotar_campos")!.args).toMatchObject({
      p_org: ORG_TIME,
      p_lead: LEAD,
      p_campos: { raio_x_situacao: "pediu a grátis de novo (já usada)" },
    });
    expect(m.banco.db.crm_lead_activities![0]).toMatchObject({ organization_id: ORG_TIME, lead_id: LEAD, type: "note", source_module: "raio_x", actor_kind: "system" });
  });

  it("⭐ uma por conta: o mesmo e-mail com outro número também já usou", async () => {
    const m = mundo();
    expect((await cadastrar(admin(m), dados(), m.deps)).tipo).toBe("criado");
    const outro = await cadastrar(admin(m), dados({ whatsapp: "(31) 90000-1199" }), m.deps);
    expect(outro.tipo).toBe("ja_usou");
    expect(m.banco.db.mia_raio_x).toHaveLength(1);
  });

  it("⭐ o 2º cadastro com o MESMO e-mail e outro telefone não muda a conta nem o contato do lead: só a nota, mascarada", async () => {
    const m = mundo();
    const um = await cadastrar(admin(m), dados(), m.deps);
    if (um.tipo !== "criado") throw new Error("não criou");
    const contaAntes = structuredClone(m.banco.db.mia_raio_x_contas);
    // A grátis anterior não contou: o segundo cadastro cria outro raio-X (com o WhatsApp e a empresa DELE).
    Object.assign(m.banco.db.mia_raio_x![0]!, { situacao: "encerrado", sem_historico_em: T0.toISOString() });
    const dois = await cadastrar(
      admin(m),
      dados({ nome: "Outro Nome Modelo", telefone: "(31) 90000-2299", whatsapp: "(31) 90000-1188", empresa: "Garagem Modelo Dois" }),
      m.deps,
    );
    expect(dois.tipo).toBe("criado");
    // A conta ficou como estava, e o cadastro não foi de novo à fonte (o contato do lead não muda).
    expect(m.banco.db.mia_raio_x_contas).toEqual(contaAntes);
    expect(m.capturas).toHaveLength(1);
    // O raio-X novo guarda o que o formulário mandou.
    expect(m.banco.db.mia_raio_x![1]).toMatchObject({ whatsapp: "5531900001188", empresa: "Garagem Modelo Dois", conta_id: um.conta.id });
    // O lead ganha só a nota, com os telefones mascarados.
    const nota = m.banco.db.crm_lead_activities!.at(-1)!;
    expect(nota).toMatchObject({ lead_id: LEAD, type: "note" });
    expect(String(nota.reason)).toContain("Novo cadastro com o mesmo e-mail");
    expect(String(nota.reason)).toContain("2299");
    expect(String(nota.reason)).not.toMatch(/90000-?2299|5531900002299/);
    expect(m.banco.chamadasRpc.filter((c) => c.nome === "fn_lead_anotar_campos")).toHaveLength(0);
    // E a grátis já usada, com o mesmo e-mail: também só a nota, e a conta segue igual.
    const tres = await cadastrar(admin(m), dados({ telefone: "(31) 90000-2277" }), m.deps);
    expect(tres.tipo).toBe("ja_usou");
    expect(m.banco.db.mia_raio_x_contas).toEqual(contaAntes);
    expect(m.capturas).toHaveLength(1);
  });

  it("a grátis que fechou sem histórico não conta: o mesmo número cadastra de novo", async () => {
    const m = mundo();
    const um = await cadastrar(admin(m), dados(), m.deps);
    if (um.tipo !== "criado") throw new Error("não criou");
    Object.assign(m.banco.db.mia_raio_x![0]!, { situacao: "encerrado", sem_historico_em: new Date(T0.getTime() + DIA).toISOString() });
    const dois = await cadastrar(admin(m), dados(), m.deps);
    expect(dois.tipo).toBe("criado");
    expect(m.banco.db.mia_raio_x).toHaveLength(2);
  });
});

// ─── 4. o código de acesso ──────────────────────────────────────────────────

describe("o código de acesso, no banco", () => {
  const conta = { id: "e9152e90-5555-4000-8000-000000000001", email: "ricardo@garagemmodelo.com.br", nome: "Ricardo Exemplo", telefone: "5531900002202", crm_lead_id: null, crm_enviado_em: null, crm_erro: null, asaas_cliente_id: null, ultimo_acesso_em: null, created_at: T0.toISOString() };

  it("só o hash no banco, 15 minutos; e-mail sem conta não grava nada (quem chama responde igual)", async () => {
    const m = mundo({ mia_raio_x_contas: [conta] });
    const criado = await criarCodigoDeAcesso(admin(m), "Ricardo@GaragemModelo.com.br", T0);
    expect(criado?.codigo).toMatch(/^\d{6}$/);
    const linha = m.banco.db.mia_raio_x_codigos_de_acesso![0]!;
    expect(String(linha.codigo_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(m.banco.db.mia_raio_x_codigos_de_acesso)).not.toContain(criado!.codigo);
    expect(Date.parse(String(linha.expira_em)) - T0.getTime()).toBe(15 * MIN);
    expect(await criarCodigoDeAcesso(admin(m), "ninguem@garagemmodelo.com.br", T0)).toBeNull();
    expect(m.banco.db.mia_raio_x_codigos_de_acesso).toHaveLength(1);
  });

  it("⭐ o certo entra uma vez só; o errado conta; vencido não entra", async () => {
    const m = mundo({ mia_raio_x_contas: [conta] });
    const { codigo } = (await criarCodigoDeAcesso(admin(m), conta.email, T0))!;
    const errado = codigo === "000000" ? "111111" : "000000";
    expect(await conferirCodigoDeAcesso(admin(m), conta.email, errado, T0)).toMatchObject({ ok: false, motivo: "errado" });
    const certo = await conferirCodigoDeAcesso(admin(m), conta.email, codigo, T0);
    expect(certo.ok).toBe(true);
    expect(m.banco.db.mia_raio_x_contas![0]!.ultimo_acesso_em).toBe(T0.toISOString());
    // Usado: não entra de novo.
    expect((await conferirCodigoDeAcesso(admin(m), conta.email, codigo, T0)).ok).toBe(false);
    // Um código novo, 16 minutos depois: vencido.
    const outro = (await criarCodigoDeAcesso(admin(m), conta.email, new Date(T0.getTime() + MIN)))!;
    expect(await conferirCodigoDeAcesso(admin(m), conta.email, outro.codigo, new Date(T0.getTime() + 17 * MIN))).toMatchObject({ ok: false, motivo: "vencido" });
  });

  it("⭐ cinco tentativas erradas esgotam o código (nem o certo entra depois)", async () => {
    const m = mundo({ mia_raio_x_contas: [conta] });
    const { codigo } = (await criarCodigoDeAcesso(admin(m), conta.email, T0))!;
    const errado = codigo === "000000" ? "111111" : "000000";
    for (let i = 0; i < TENTATIVAS_DO_CODIGO; i += 1) expect((await conferirCodigoDeAcesso(admin(m), conta.email, errado, T0)).ok).toBe(false);
    expect(await conferirCodigoDeAcesso(admin(m), conta.email, codigo, T0)).toMatchObject({ ok: false, motivo: "esgotado" });
  });

  it("e-mail que não existe responde como código errado, sem tocar em código nenhum", async () => {
    const m = mundo({ mia_raio_x_contas: [conta] });
    expect(await conferirCodigoDeAcesso(admin(m), "ninguem@garagemmodelo.com.br", "482913", T0)).toMatchObject({ ok: false, motivo: "errado" });
    expect(m.banco.escritas.filter((e) => e.tabela === "mia_raio_x_codigos_de_acesso")).toHaveLength(0);
  });
});

// ─── 5. a área ──────────────────────────────────────────────────────────────

describe("a área só vê o que é da conta", () => {
  it("⭐ o raio-X de outra conta responde como inexistente", async () => {
    const m = mundo();
    const um = await cadastrar(admin(m), dados(), m.deps);
    const dois = await cadastrar(admin(m), dados({ email: "outra@garagemmodelo.com.br", whatsapp: "(31) 90000-1102" }), m.deps);
    if (um.tipo !== "criado" || dois.tipo !== "criado") throw new Error("não criou");
    expect((await raioXDaContaPeloId(admin(m), um.conta, um.raioX.id))?.raioX.id).toBe(um.raioX.id);
    expect(await raioXDaContaPeloId(admin(m), um.conta, dois.raioX.id)).toBeNull();
    expect(await raioXDaContaPeloId(admin(m), um.conta, "nao-e-uuid")).toBeNull();
  });
});

// ─── 6. o ciclo ─────────────────────────────────────────────────────────────

const RX = "e9152e90-2222-4000-8000-0000000106c1";
const CONTA = "e9152e90-5555-4000-8000-0000000106c1";

function raioXAnalisando(extra: Partial<Linha> = {}): Linha {
  return {
    id: RX,
    fonte: "conexao",
    primeira_conversa_em: null,
    empresa: "Garagem Modelo Veículos",
    segmento: "revenda_de_veiculos",
    whatsapp: "5531900001101",
    responsavel_nome: "Ricardo Exemplo",
    responsavel_contato: "ricardo@garagemmodelo.com.br",
    quem_atende: "humano",
    periodo_dias: 30,
    tipo: "unico",
    abre: "08:00:00",
    fecha: "18:00:00",
    sabado_ate: "13:00:00",
    organization_id: null,
    teto_centavos: 500,
    situacao: "analisando",
    conexao_versao: 1,
    conexao_expira_em: T0.toISOString(),
    sessao: "raiox_e9152e9022224000800001",
    conectado_em: new Date(T0.getTime() - 60 * MIN).toISOString(),
    numero_conectado: "5531900001101",
    ciclo: 1,
    periodo_inicio: new Date(T0.getTime() - 30 * DIA).toISOString(),
    periodo_fim: T0.toISOString(),
    competencia: null,
    leitura: { fase: "concluida" },
    leitura_concluida_em: T0.toISOString(),
    analise: {},
    trava_ate: null,
    ultimo_relatorio_em: null,
    desconectar_em: null,
    desconectado_em: null,
    apagar_conversas_em: null,
    conversas_apagadas_em: null,
    encerrado_em: null,
    criado_por: null,
    criado_via: "cadastro",
    created_at: new Date(T0.getTime() - DIA).toISOString(),
    updated_at: new Date(T0.getTime() - MIN).toISOString(),
    origem: "cadastro",
    gratis: true,
    conta_id: CONTA,
    sem_historico_em: null,
    entregue_em: null,
    ...extra,
  };
}

const CONTA_DO_CICLO: Linha = { id: CONTA, email: "ricardo@garagemmodelo.com.br", nome: "Ricardo Exemplo", telefone: "5531900002202", crm_lead_id: null, crm_enviado_em: null, crm_erro: null, asaas_cliente_id: null, ultimo_acesso_em: null, created_at: T0.toISOString() };

/** Uma conversa lida com uma mensagem do cliente, e o teto já gasto: o relatório sai sem chamar o modelo. */
function comUmaConversa(m: ReturnType<typeof mundo>) {
  m.banco.db.mia_raio_x_conversas = [
    { id: "conversa-1", raio_x_id: RX, chat_marca: "a".repeat(64), referencia: null, numero_ordem: 1, anuncio: false, ultima_em: new Date(T0.getTime() - DIA).toISOString(), analise_ciclo: null, analise: null, fora_do_teto: false },
  ];
  m.banco.db.mia_raio_x_mensagens = [
    { id: 1, raio_x_id: RX, conversa_id: "conversa-1", marca: "b".repeat(64), da_loja: false, enviada_em: new Date(T0.getTime() - DIA).toISOString(), tipo: "texto", texto: "Ainda tem o carro?", transcricao: "nao_se_aplica" },
  ];
  m.banco.db.mia_raio_x_gastos = [{ raio_x_id: RX, ciclo: 1, proposito: "raio_x_analise", modelo: "gpt-6-luna", custo_usd_centavos: 83, cotacao: 6, custo_centavos: 499.99 }];
}

async function umaRodada(m: ReturnType<typeof mundo>) {
  const chamar = vi.fn(async () => ({ texto: "{}", tokensEntrada: 0, tokensSaida: 0, cacheLido: 0 }));
  const r = await rodarOCiclo({
    admin: admin(m),
    leitor: m.leitor,
    prazo: T0.getTime() + 10 * MIN,
    agora: () => T0.getTime(),
    modelo: { provedor: "openai", modelo: "gpt-6-luna", chave: "chave-de-teste" },
    chamar,
    transcritor: null,
    entrega: { lead: m.lead, enviarEmail: (m.deps as { enviarEmail: EnviarEmail }).enviarEmail, emailDaTime: "equipe@exemplo.invalid" },
  });
  return { r, chamar };
}

describe("o ciclo: o do cadastro vai direto, o da Time continua com revisão", () => {
  it("⭐ o do cadastro sai REVISADO, sem ator, e vai para a pessoa, o lead e a Time", async () => {
    const m = mundo({ mia_raio_x: [raioXAnalisando()], mia_raio_x_contas: [CONTA_DO_CICLO] });
    comUmaConversa(m);
    const { r } = await umaRodada(m);
    expect(r.efeitos.map((e) => e.acao)).toEqual(["raio_x.relatorio_gerado", "raio_x.relatorio_entregue"]);
    const rel = m.banco.db.mia_raio_x_relatorios![0]!;
    expect(rel).toMatchObject({ situacao: "revisado", revisado_por: null, notas_da_time: "automático: cadastro" });
    expect(rel.revisado_em).toBe(T0.toISOString());
    expect(m.banco.db.mia_raio_x![0]).toMatchObject({ situacao: "pronto", entregue_em: T0.toISOString() });
    // O link do dono do cadastro, 30 dias.
    expect(m.banco.db.mia_raio_x_links![0]).toMatchObject({ relatorio_id: rel.id, created_via: "cadastro" });
    // O e-mail para a pessoa e o aviso por e-mail à Time.
    const pronto = m.emails.find((e) => e.to === "ricardo@garagemmodelo.com.br")!;
    expect(pronto.subject).toContain("Seu Raio-X do atendimento está pronto, Ricardo");
    expect(pronto.text).toContain("/raio-x/entrar");
    expect(pronto.text).not.toMatch(/—|\bIA\b/);
    expect(m.emails.some((e) => e.to === "equipe@exemplo.invalid" && e.subject.includes("Garagem Modelo Veículos recebeu o Raio-X"))).toBe(true);
    // O lead: os campos (nota, sem resposta, conversas, o link) e a nota; a Central da Time.
    const campos = m.banco.chamadasRpc.find((c) => c.nome === "fn_lead_anotar_campos")!.args as { p_campos: Record<string, unknown> };
    expect(campos.p_campos).toMatchObject({ raio_x_situacao: "relatório pronto", raio_x_sem_resposta: 1, raio_x_conversas: 1 });
    expect(String(campos.p_campos.raio_x_relatorio)).toMatch(/\/raio-x\/relatorio\/[0-9a-z]{24}$/);
    expect(m.banco.db.agent_inbox_items![0]).toMatchObject({ organization_id: ORG_TIME, kind: "other", ref_kind: "lead", ref_id: LEAD });
    // Nenhum texto de conversa nem telefone de cliente no lead.
    expect(JSON.stringify([campos, m.banco.db.crm_lead_activities])).not.toMatch(/Ainda tem o carro/);
  });

  it("⭐ o da Time continua saindo em RASCUNHO e não vai a ninguém", async () => {
    const m = mundo({ mia_raio_x: [raioXAnalisando({ origem: "time", gratis: false, conta_id: null, criado_via: "tela" })] });
    comUmaConversa(m);
    const { r } = await umaRodada(m);
    expect(r.efeitos.map((e) => e.acao)).toEqual(["raio_x.relatorio_gerado"]);
    const rel = m.banco.db.mia_raio_x_relatorios![0]!;
    expect(rel.situacao ?? "rascunho").toBe("rascunho");
    expect(rel.revisado_em ?? null).toBeNull();
    expect(m.banco.db.mia_raio_x_links ?? []).toHaveLength(0);
    expect(m.emails).toHaveLength(0);
    expect(m.capturas).toHaveLength(0);
  });

  it("⭐ 0 conversas num grátis: sem relatório, encerrado e marcado, e a grátis NÃO foi gasta", async () => {
    const m = mundo({ mia_raio_x: [raioXAnalisando()], mia_raio_x_contas: [CONTA_DO_CICLO] });
    const { r } = await umaRodada(m);
    expect(r.efeitos).toContainEqual({ acao: "raio_x.sem_historico", raioXId: RX, email: true });
    expect(m.banco.db.mia_raio_x_relatorios ?? []).toHaveLength(0);
    const rx = m.banco.db.mia_raio_x![0]!;
    expect(rx.situacao).toBe("encerrado");
    expect(rx.sem_historico_em).toBe(T0.toISOString());
    // A conexão caiu.
    expect(m.leitorPedidos).toContain(`desconectar:${rx.sessao ?? "raiox_e9152e9022224000800001"}`);
    // O e-mail diz para tentar de novo; o mesmo número cadastra outra grátis.
    expect(m.emails.find((e) => e.to === "ricardo@garagemmodelo.com.br")?.text).toContain("/raio-x/gratis");
    const de_novo = await cadastrar(admin(m), dados(), m.deps);
    expect(de_novo.tipo).toBe("criado");
  });
});

// ─── 7. a nova análise e o pagamento ────────────────────────────────────────

const PRONTO = () =>
  raioXAnalisando({
    situacao: "pronto",
    ultimo_relatorio_em: T0.toISOString(),
    desconectar_em: new Date(T0.getTime() + 7 * DIA).toISOString(),
  });

function asaasDeTeste(rotas: Parameters<typeof asaasFalso>[0]) {
  const a = asaasFalso(rotas);
  return { ...a, deps: { fetch: a.fetch, lerChave: async () => CHAVE_DE_TESTE, baseDeTeste: "http://127.0.0.1:3995" } };
}

describe("a nova análise", () => {
  it("⭐ sem preço: o pedido vira INTERESSE, o lead e a Time ficam sabendo, e o Asaas não é chamado", async () => {
    const m = mundo({ mia_raio_x: [PRONTO()], mia_raio_x_contas: [CONTA_DO_CICLO] });
    const asaas = asaasDeTeste({});
    const r = await pedirNovaAnalise(admin(m), CONTA_DO_CICLO as never, { tipo: "avulsa", aceite: true }, { asaas: asaas.deps, lead: m.lead, enviarEmail: m.deps.enviarEmail, emailDaTime: "equipe@exemplo.invalid", agora: T0 });
    expect(r.ok && r.situacao).toBe("interesse");
    expect(m.banco.db.mia_raio_x_pedidos![0]).toMatchObject({ tipo: "avulsa", situacao: "interesse", valor_centavos: null, anterior_id: RX, whatsapp: "5531900001101" });
    expect(asaas.chamadas).toHaveLength(0);
    expect(m.banco.chamadasRpc.find((c) => c.nome === "fn_lead_anotar_campos")!.args).toMatchObject({ p_campos: { raio_x_pedido: "nova análise avulsa: interesse" } });
    expect(m.emails.some((e) => e.to === "equipe@exemplo.invalid" && e.subject.includes("quer uma nova análise avulsa"))).toBe(true);
  });

  it("recusa sem a autorização, com o tipo errado e com o raio-X ainda em andamento", async () => {
    const m = mundo({ mia_raio_x: [raioXAnalisando()], mia_raio_x_contas: [CONTA_DO_CICLO] });
    expect(await pedirNovaAnalise(admin(m), CONTA_DO_CICLO as never, { tipo: "avulsa" })).toEqual({ ok: false, motivo: "aceite" });
    expect(await pedirNovaAnalise(admin(m), CONTA_DO_CICLO as never, { tipo: "anual", aceite: true })).toEqual({ ok: false, motivo: "tipo" });
    expect(await pedirNovaAnalise(admin(m), CONTA_DO_CICLO as never, { tipo: "avulsa", aceite: true })).toEqual({ ok: false, motivo: "em_andamento" });
  });

  it("⭐ com preço (avulsa): o cliente da conta e a cobrança no Asaas com a referência do pedido, e o link", async () => {
    const m = mundo({ mia_raio_x: [PRONTO()], mia_raio_x_contas: [CONTA_DO_CICLO], mia_raio_x_precos: [{ tipo: "avulsa", valor_centavos: 7900, ativo: true, updated_at: T0.toISOString() }] });
    const asaas = asaasDeTeste({
      "GET /customers": { corpo: { data: [] } },
      "POST /customers": { corpo: { id: "cus_raiox_teste" } },
      "POST /payments": { corpo: { id: "pay_raiox_teste", status: "PENDING", invoiceUrl: "http://127.0.0.1:3995/i/pay_raiox_teste" } },
    });
    // Sem o documento, o Asaas não cria o cliente: a tela pede.
    expect(await pedirNovaAnalise(admin(m), CONTA_DO_CICLO as never, { tipo: "avulsa", aceite: true }, { asaas: asaas.deps, lead: m.lead, agora: T0 })).toEqual({ ok: false, motivo: "documento" });
    const r = await pedirNovaAnalise(admin(m), CONTA_DO_CICLO as never, { tipo: "avulsa", aceite: true, documento: "529.982.247-25" }, { asaas: asaas.deps, lead: m.lead, agora: T0 });
    expect(r.ok && r.situacao).toBe("aguardando");
    const pedido = m.banco.db.mia_raio_x_pedidos![0]! as unknown as LinhaDoPedido;
    expect(pedido).toMatchObject({ situacao: "aguardando", valor_centavos: 7900, asaas_cobranca_id: "pay_raiox_teste", link_pagamento: "http://127.0.0.1:3995/i/pay_raiox_teste" });
    const cliente = JSON.parse(asaas.chamadas.find((c) => c.metodo === "POST" && c.caminho === "/customers")!.corpo) as Record<string, unknown>;
    expect(cliente).toMatchObject({ name: "Ricardo Exemplo", cpfCnpj: "52998224725", externalReference: `raiox-conta:${CONTA}`, notificationDisabled: true });
    const cobranca = JSON.parse(asaas.chamadas.find((c) => c.metodo === "POST" && c.caminho === "/payments")!.corpo) as Record<string, unknown>;
    expect(cobranca).toMatchObject({ customer: "cus_raiox_teste", billingType: "UNDEFINED", value: 79, externalReference: `raiox-pedido:${pedido.id}` });
    // O documento não fica guardado aqui.
    expect(JSON.stringify(m.banco.db)).not.toContain("52998224725");
    expect(m.banco.db.mia_raio_x_contas![0]!.asaas_cliente_id).toBe("cus_raiox_teste");
  });

  it("⭐ pago: a releitura no Asaas cria o raio-X novo da conta (o mesmo número, não grátis) uma vez só, e a conexão passa para ele", async () => {
    const pedidoId = "e9152e90-6666-4000-8000-000000000001";
    const m = mundo({
      mia_raio_x: [PRONTO()],
      mia_raio_x_contas: [{ ...CONTA_DO_CICLO, asaas_cliente_id: "cus_raiox_teste" }],
      mia_raio_x_pedidos: [{ id: pedidoId, conta_id: CONTA, anterior_id: RX, raio_x_id: null, whatsapp: "5531900001101", tipo: "avulsa", valor_centavos: 7900, situacao: "aguardando", asaas_cobranca_id: "pay_raiox_teste", asaas_assinatura_id: null, link_pagamento: "http://127.0.0.1:3995/i/pay_raiox_teste", erro: null, pago_em: null, cancelado_em: null, created_at: T0.toISOString() }],
    });
    const asaas = asaasDeTeste({ "GET /payments/pay_raiox_teste": { corpo: { id: "pay_raiox_teste", status: "RECEIVED", externalReference: `raiox-pedido:${pedidoId}` } } });
    const deps = { asaas: asaas.deps, lead: m.lead, enviarEmail: m.deps.enviarEmail, leitor: m.leitor, agora: T0 };
    const r = await relerPedidosDaConta(admin(m), CONTA, deps);
    expect(r.pagos).toHaveLength(1);
    expect(m.banco.db.mia_raio_x_pedidos![0]).toMatchObject({ situacao: "pago", pago_em: T0.toISOString(), raio_x_id: r.pagos[0]!.raioXId });
    const novo = m.banco.db.mia_raio_x!.find((x) => x.id === r.pagos[0]!.raioXId)!;
    expect(novo).toMatchObject({ origem: "cadastro", gratis: false, conta_id: CONTA, whatsapp: "5531900001101", tipo: "unico", criado_via: "cadastro", situacao: "conectando" });
    // O WhatsApp do anterior seguia conectado: a sessão passou para o novo.
    const anterior = m.banco.db.mia_raio_x!.find((x) => x.id === RX)!;
    expect(novo.sessao).toBe("raiox_e9152e9022224000800001");
    expect(anterior.sessao).toBeNull();
    expect(anterior.desconectar_em).toBeNull();
    // O aceite do novo, com a pessoa da conta.
    expect(m.banco.db.mia_raio_x_aceites!.find((a) => a.raio_x_id === novo.id)).toMatchObject({ nome: "Ricardo Exemplo", termo_versao: "v1" });
    expect(m.emails.find((e) => e.to === "ricardo@garagemmodelo.com.br")?.subject).toContain("Pagamento confirmado");
    // Reler de novo não cria outro.
    expect((await relerPedidosDaConta(admin(m), CONTA, deps)).pagos).toHaveLength(0);
    expect(m.banco.db.mia_raio_x).toHaveLength(2);
  });

  it("cancelado ou estornado marca o pedido, e nada nasce", async () => {
    const pedidoId = "e9152e90-6666-4000-8000-000000000002";
    const m = mundo({
      mia_raio_x: [PRONTO()],
      mia_raio_x_contas: [{ ...CONTA_DO_CICLO, asaas_cliente_id: "cus_raiox_teste" }],
      mia_raio_x_pedidos: [{ id: pedidoId, conta_id: CONTA, anterior_id: RX, raio_x_id: null, whatsapp: "5531900001101", tipo: "avulsa", valor_centavos: 7900, situacao: "aguardando", asaas_cobranca_id: "pay_estornado", asaas_assinatura_id: null, link_pagamento: null, erro: null, pago_em: null, cancelado_em: null, created_at: T0.toISOString() }],
    });
    const asaas = asaasDeTeste({ "GET /payments/pay_estornado": { corpo: { id: "pay_estornado", status: "REFUNDED", externalReference: `raiox-pedido:${pedidoId}` } } });
    const r = await relerPedidosDaConta(admin(m), CONTA, { asaas: asaas.deps, lead: m.lead, agora: T0 });
    expect(r.cancelados).toEqual([pedidoId]);
    expect(m.banco.db.mia_raio_x_pedidos![0]).toMatchObject({ situacao: "cancelado", cancelado_em: T0.toISOString() });
    expect(m.banco.db.mia_raio_x).toHaveLength(1);
  });
});
