/**
 * FORK MIA (.94) · PREPARAR as nove peças do dia a dia (protótipo "ensina e
 * faz", tela 3): ler o que existe com o cliente de QUEM CHAMA (a sessão, no
 * turno e no ajuste) e montar o cartão, sem gravar nada.
 *
 * "Propor não cria rascunho nem efeito colateral" (#2860): aqui só se lê. A
 * peça nasce no aplicar (`aplicar-do-dia-a-dia.ts`), pelo mesmo caminho da
 * tela. Cada preparação devolve, em vez da proposta, que a peça JÁ EXISTE (e
 * onde ela está) ou que o pedido não fecha (e o porquê, para o assistente
 * dizer). A `chave` é a peça: pedir de novo a mesma coisa devolve o mesmo
 * cartão (9100).
 *
 * Este arquivo não importa o cliente de serviço.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { instanteDe, partesNoFuso } from "@/lib/agenda/fuso";
import { roleAtLeast, type Role } from "@/lib/auth/types";
import { modeloPorId } from "@/lib/followup/modelos";
import { chaveDoNome } from "@/lib/implantacao/base";
import { modeloDoSegmento } from "@/lib/onboarding/modelos-de-agente-da-mia";
import { chaveDaEtiqueta, NOME_DO_TOM, PALETA_DE_ETIQUETAS } from "@/lib/tags/cor-da-etiqueta";

import { formatarDinheiro } from "../dinheiro";
import type { PessoaDaEquipe } from "../leituras/comum";
import { lerEmpresaParaOModelo, type Preparacao } from "./preparar";
import type {
  AgrupamentoDoRelatorio,
  ParaQuem,
  PedidoDeRascunhoDeFollowup,
  PeriodoDoRelatorio,
  PropostaDoTurno,
} from "./tipos";

export interface ContextoDaPreparacao {
  /** O cliente de quem chama (a sessão). */
  db: SupabaseClient;
  organizationId: string;
  userId: string;
  papel: Role;
  equipe: readonly PessoaDaEquipe[];
  fuso: string;
  agora: Date;
  idioma: string;
}

const recusa = (mensagem: string, motivo: "invalido" | "ja_existe" | "depende" = "invalido", href?: string): Preparacao => ({
  ok: false,
  motivo,
  mensagem,
  ...(href ? { href } : {}),
});

const pronta = (proposta: PropostaDoTurno): Preparacao => ({ ok: true, proposta });

// ── o funil e as etapas ─────────────────────────────────────────────────────

interface FunilLido {
  id: string;
  name: string;
  is_default: boolean;
}

interface EtapaLida {
  id: string;
  name: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
}

async function lerFunis(db: SupabaseClient, orgId: string): Promise<FunilLido[]> {
  const { data } = await db
    .from("crm_pipelines")
    .select("id, name, is_default")
    .eq("organization_id", orgId)
    .eq("is_archived", false)
    .order("created_at", { ascending: true })
    .limit(50);
  return (data ?? []) as FunilLido[];
}

async function lerEtapas(db: SupabaseClient, orgId: string, funilId: string): Promise<EtapaLida[]> {
  const { data } = await db
    .from("crm_stages")
    .select("id, name, position, is_won, is_lost")
    .eq("organization_id", orgId)
    .eq("pipeline_id", funilId)
    .eq("is_archived", false)
    .order("position", { ascending: true })
    .limit(100);
  return ((data ?? []) as Array<EtapaLida & { position: number | string }>).map((e) => ({ ...e, position: Number(e.position) }));
}

/** O funil pelo nome (ou id); sem nome, o padrão da empresa. */
async function acharFunil(c: ContextoDaPreparacao, referencia: string | null | undefined): Promise<FunilLido | Preparacao> {
  const funis = await lerFunis(c.db, c.organizationId);
  if (funis.length === 0) return recusa("A empresa ainda não tem funil. Montar o funil é em Etapas do funil.", "depende", "/app/settings/tenant/pipelines");
  if (!referencia?.trim()) return funis.find((f) => f.is_default) ?? funis[0]!;
  const ref = referencia.trim();
  const achado = funis.find((f) => f.id === ref) ?? funis.find((f) => chaveDoNome(f.name) === chaveDoNome(ref));
  if (!achado) {
    return recusa(`Não achei o funil «${ref}». Os funis são: ${funis.map((f) => `«${f.name}»`).join(", ")}.`);
  }
  return achado;
}

const ehPreparacao = (x: unknown): x is Preparacao => typeof x === "object" && x !== null && "ok" in x;

export interface EntradaDeEtapaNova {
  funil?: string | null;
  nome: string;
  antes_de?: string | null;
}

export async function prepararEtapaNova(c: ContextoDaPreparacao, e: EntradaDeEtapaNova): Promise<Preparacao> {
  const nome = e.nome.trim().replace(/\s+/g, " ");
  if (nome.length < 2 || nome.length > 80) return recusa("O nome da etapa tem de ter de 2 a 80 letras.");
  const funil = await acharFunil(c, e.funil);
  if (ehPreparacao(funil)) return funil;
  const etapas = await lerEtapas(c.db, c.organizationId, funil.id);
  if (etapas.some((x) => chaveDoNome(x.name) === chaveDoNome(nome))) {
    return recusa(`A etapa «${nome}» já existe no funil «${funil.name}».`, "ja_existe", "/app/settings/tenant/pipelines");
  }
  let antes: EtapaLida | null = null;
  if (e.antes_de?.trim()) {
    antes = etapas.find((x) => chaveDoNome(x.name) === chaveDoNome(e.antes_de!)) ?? null;
    if (!antes) {
      return recusa(`Não achei a etapa «${e.antes_de.trim()}» no funil «${funil.name}». As etapas são: ${etapas.map((x) => `«${x.name}»`).join(", ")}.`);
    }
  } else {
    // Sem lugar pedido, a etapa entra antes da de ganho ou de perda: é uma etapa
    // do caminho, e não depois do fim.
    antes = etapas.find((x) => x.is_won || x.is_lost) ?? null;
  }
  const depois = [...etapas.map((x) => x.name)];
  depois.splice(antes ? depois.indexOf(antes.name) : depois.length, 0, nome);
  return pronta({
    tipo: "etapa_criar",
    titulo: antes ? `Criar a etapa "${nome}" antes de "${antes.name}"` : `Criar a etapa "${nome}" no fim do funil "${funil.name}"`,
    mudancas: [
      { rotulo: "Funil", valor: funil.name },
      { rotulo: "Antes", valor: etapas.map((x) => x.name).join(" · ") },
      { rotulo: "Depois", valor: depois.join(" · ") },
    ],
    pedido: { funil_id: funil.id, funil_nome: funil.name, nome, antes_de_id: antes?.id ?? null, antes_de_nome: antes?.name ?? null },
    chave: `${funil.id}:${chaveDoNome(nome)}`,
  });
}

export interface EntradaDeRenomearEtapa {
  funil?: string | null;
  de: string;
  para: string;
}

export async function prepararRenomearEtapa(c: ContextoDaPreparacao, e: EntradaDeRenomearEtapa): Promise<Preparacao> {
  const para = e.para.trim().replace(/\s+/g, " ");
  if (para.length < 2 || para.length > 80) return recusa("O nome novo da etapa tem de ter de 2 a 80 letras.");
  const funil = await acharFunil(c, e.funil);
  if (ehPreparacao(funil)) return funil;
  const etapas = await lerEtapas(c.db, c.organizationId, funil.id);
  const etapa = etapas.find((x) => x.id === e.de.trim()) ?? etapas.find((x) => chaveDoNome(x.name) === chaveDoNome(e.de));
  if (!etapa) {
    return recusa(`Não achei a etapa «${e.de.trim()}» no funil «${funil.name}». As etapas são: ${etapas.map((x) => `«${x.name}»`).join(", ")}.`);
  }
  if (chaveDoNome(etapa.name) === chaveDoNome(para)) return recusa(`A etapa já se chama «${etapa.name}».`, "ja_existe");
  if (etapas.some((x) => x.id !== etapa.id && chaveDoNome(x.name) === chaveDoNome(para))) {
    return recusa(`Já existe a etapa «${para}» no funil «${funil.name}».`, "ja_existe");
  }
  return pronta({
    tipo: "etapa_renomear",
    titulo: `Renomear "${etapa.name}" para "${para}"`,
    mudancas: [
      { rotulo: "Funil", valor: funil.name },
      { rotulo: "Etapa", valor: `${etapa.name} → ${para}` },
    ],
    pedido: { funil_id: funil.id, funil_nome: funil.name, etapa_id: etapa.id, de: etapa.name, para },
    chave: etapa.id,
  });
}

// ── resposta rápida ─────────────────────────────────────────────────────────

/** O atalho como a tela grava: sem a barra, sem espaço, em minúsculas. */
export function atalhoLimpo(bruto: string): string {
  return bruto.trim().toLowerCase().replace(/^\/+/, "").replace(/\s+/g, "");
}

export interface EntradaDeResposta {
  atalho: string;
  texto: string;
  titulo?: string | null;
  para?: ParaQuem | null;
}

export async function prepararResposta(c: ContextoDaPreparacao, e: EntradaDeResposta): Promise<Preparacao> {
  const atalho = atalhoLimpo(e.atalho);
  if (atalho.length < 2 || atalho.length > 40) return recusa("O atalho tem de ter de 2 a 40 letras, sem espaço (ex.: /endereco).");
  const texto = e.texto.trim();
  if (texto.length < 3 || texto.length > 4096) return recusa("O texto da resposta tem de ter de 3 a 4.096 caracteres.");
  const para: ParaQuem = e.para ?? (roleAtLeast(c.papel, "manager") ? "equipe" : "eu");
  const titulo = (e.titulo?.trim() || atalho.charAt(0).toUpperCase() + atalho.slice(1)).slice(0, 80);
  // As que esta pessoa vê: as da equipe e as dela (a RLS de message_templates).
  const { data } = await c.db
    .from("message_templates")
    .select("id, title, shortcut, owner_user_id")
    .eq("organization_id", c.organizationId)
    .limit(500);
  const ja = ((data ?? []) as Array<{ title: string; shortcut: string | null }>).find(
    (t) => (t.shortcut && atalhoLimpo(t.shortcut) === atalho) || chaveDoNome(t.title) === chaveDoNome(titulo),
  );
  if (ja) return recusa(`Já existe a resposta rápida «${ja.title}»${ja.shortcut ? ` (/${atalhoLimpo(ja.shortcut)})` : ""}.`, "ja_existe", "/app/templates");
  return pronta({
    tipo: "resposta",
    titulo: `Criar a resposta rápida /${atalho}`,
    mudancas: [
      { rotulo: "Atalho", valor: `/${atalho}` },
      { rotulo: "Texto", valor: texto },
      { rotulo: "Quem usa", valor: para === "eu" ? "só quem pediu" : "toda a equipe" },
    ],
    pedido: { atalho, titulo, texto, para },
    chave: `${para === "eu" ? `eu:${c.userId}` : "equipe"}:${atalho}`,
  });
}

// ── etiqueta ────────────────────────────────────────────────────────────────

/** Os nomes do vocabulário (`organizations.settings.tags`: texto ou `{ tag, cor }`). */
export function nomesDoVocabulario(settings: unknown): string[] {
  const lista = (settings as Record<string, unknown> | null | undefined)?.["tags"];
  if (!Array.isArray(lista)) return [];
  return lista
    .map((x) => (typeof x === "string" ? x : typeof x === "object" && x !== null ? (x as { tag?: unknown }).tag : null))
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .map((x) => x.trim());
}

const SEM_ACENTO = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A cor pelo nome que a pessoa disse ("verde", "roxo") ou pelo `#rrggbb` da paleta. */
export function corDaPaleta(pedida: string | null | undefined, usadas: readonly string[] = []): string {
  const cores = PALETA_DE_ETIQUETAS as readonly string[];
  const bruto = (pedida ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(bruto) && cores.includes(bruto.toLowerCase())) return bruto.toLowerCase();
  const nome = SEM_ACENTO(bruto);
  if (nome) {
    const apelido: Record<string, string> = { verde: "verde-agua", laranja: "ambar", lilas: "roxo", violeta: "roxo", cinzento: "cinza" };
    const alvo = apelido[nome] ?? nome;
    const achada = Object.entries(NOME_DO_TOM).find(([, tom]) => SEM_ACENTO(tom) === alvo);
    if (achada) return achada[0];
  }
  return cores.find((cor) => !usadas.includes(cor)) ?? cores[4] ?? "#0091ff";
}

export interface EntradaDeEtiqueta {
  nome: string;
  cor?: string | null;
}

export async function prepararEtiqueta(c: ContextoDaPreparacao, e: EntradaDeEtiqueta): Promise<Preparacao> {
  const nome = e.nome.trim().replace(/\s+/g, " ");
  if (nome.length < 2 || nome.length > 60) return recusa("O nome da etiqueta tem de ter de 2 a 60 letras.");
  const { data } = await c.db.from("organizations").select("settings").eq("id", c.organizationId).maybeSingle();
  const settings = (data as { settings?: unknown } | null)?.settings ?? {};
  const nomes = nomesDoVocabulario(settings);
  const ja = nomes.find((n) => chaveDaEtiqueta(n) === chaveDaEtiqueta(nome));
  if (ja) return recusa(`A etiqueta «${ja}» já existe.`, "ja_existe", "/app/settings/tags");
  const usadas = ((settings as { tags?: unknown[] }).tags ?? [])
    .map((x) => (typeof x === "object" && x !== null ? String((x as { cor?: unknown }).cor ?? "").toLowerCase() : ""))
    .filter(Boolean);
  const cor = corDaPaleta(e.cor, usadas);
  return pronta({
    tipo: "etiqueta",
    titulo: `Criar a etiqueta "${nome}"`,
    mudancas: [{ rotulo: "Etiqueta", valor: `${nome} · ${NOME_DO_TOM[cor] ?? cor}` }],
    pedido: { nome, cor },
    chave: chaveDaEtiqueta(nome),
  });
}

// ── tarefa ──────────────────────────────────────────────────────────────────

const DOIS = (n: number) => String(n).padStart(2, "0");

/** "amanhã, 10h", "hoje, 16h30", "quarta, 27/10, 9h". */
export function quandoLegivel(instante: Date, fuso: string, agora: Date): string {
  const p = partesNoFuso(instante, fuso);
  const h = `${p.hora}h${p.minuto ? DOIS(p.minuto) : ""}`;
  const hoje = partesNoFuso(agora, fuso);
  const diaDe = (x: { ano: number; mes: number; dia: number }) => Date.UTC(x.ano, x.mes - 1, x.dia);
  const dias = Math.round((diaDe(p) - diaDe(hoje)) / 86_400_000);
  if (dias === 0) return `hoje, ${h}`;
  if (dias === 1) return `amanhã, ${h}`;
  return `${DOIS(p.dia)}/${DOIS(p.mes)}, ${h}`;
}

/** "2026-10-27T10:00" (hora de parede da empresa) ou um instante com fuso. */
export function instanteDaTarefa(bruto: string, fuso: string): Date | null {
  const t = bruto.trim();
  const parede = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(t);
  if (parede) {
    const [, ano, mes, dia, hora, minuto] = parede;
    return instanteDe({ ano: Number(ano), mes: Number(mes), dia: Number(dia), hora: Number(hora ?? 9), minuto: Number(minuto ?? 0) }, fuso);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? null : d;
}

export interface EntradaDeTarefa {
  titulo: string;
  quando: string;
  para_user_id?: string | null;
}

export async function prepararTarefa(c: ContextoDaPreparacao, e: EntradaDeTarefa): Promise<Preparacao> {
  const titulo = e.titulo.trim().replace(/\s+/g, " ");
  if (titulo.length < 3 || titulo.length > 255) return recusa("O título da tarefa tem de ter de 3 a 255 caracteres.");
  const instante = instanteDaTarefa(e.quando, c.fuso);
  if (!instante) return recusa('Não entendi quando. Use a data e a hora, como "2026-10-27T10:00".');
  if (instante.getTime() < c.agora.getTime() - 5 * 60_000) return recusa("Essa hora já passou. Escolha uma hora que ainda vem.");
  const paraId = e.para_user_id ?? c.userId;
  const pessoa = c.equipe.find((p) => p.user_id === paraId);
  if (!pessoa) return recusa("Essa pessoa não está na equipe.");
  const quando = quandoLegivel(instante, c.fuso, c.agora);
  return pronta({
    tipo: "tarefa",
    titulo: `Criar a tarefa "${titulo}"`,
    mudancas: [
      { rotulo: "Tarefa", valor: titulo },
      { rotulo: "Quando", valor: quando },
      { rotulo: "Para", valor: paraId === c.userId ? `${pessoa.nome} (quem pediu)` : pessoa.nome },
    ],
    pedido: { titulo, vence_em: instante.toISOString(), quando, para_user_id: paraId, para_nome: pessoa.nome },
    chave: `${paraId}:${chaveDoNome(titulo)}`,
  });
}

// ── rascunho de follow-up ───────────────────────────────────────────────────

/** O modelo de retomada do segmento (24 h sem resposta); `geral-retomada` se o do segmento dispara por etapa. */
export function modeloDeRetomada(segmento: Parameters<typeof modeloDoSegmento>[0]): string {
  const doSegmento = modeloDoSegmento(segmento).followup;
  const candidato = doSegmento.passo === null ? doSegmento.modelo : "geral-retomada";
  const m = modeloPorId(candidato);
  return m && !m.pedeEtapa ? candidato : "geral-retomada";
}

const ESPERAS_PERMITIDAS: ReadonlyArray<[number, number]> = [
  [1, 3],
  [2, 4],
  [2, 5],
  [3, 7],
];

export function esperasValidas(esperas: readonly number[] | null | undefined): [number, number] {
  const a = Number(esperas?.[0]);
  const b = Number(esperas?.[1]);
  return Number.isInteger(a) && Number.isInteger(b) && a >= 1 && a <= 7 && b >= 1 && b <= 14 ? [a, b] : [2, 4];
}

export const OPCOES_DE_ESPERA = ESPERAS_PERMITIDAS;

/**
 * O nome do contato como o motor do follow-up entende (`{{primeiro_nome}}`,
 * `lib/followup/engine.ts`): "{nome}" e "{primeiro_nome}", do jeito que a pessoa
 * escreve, viram a variável de verdade.
 */
export function comAVariavelDoNome(texto: string): string {
  return texto.replace(/(?<!\{)\{\s*(nome|primeiro_nome|primeiro nome)\s*\}(?!\})/gi, "{{primeiro_nome}}");
}

export interface EntradaDeRascunhoDeFollowup {
  nome: string;
  mensagens: readonly string[];
  esperas_dias?: readonly number[] | null;
}

export async function prepararRascunhoDeFollowup(c: ContextoDaPreparacao, e: EntradaDeRascunhoDeFollowup): Promise<Preparacao> {
  const nome = e.nome.trim().replace(/\s+/g, " ");
  if (nome.length < 3 || nome.length > 80) return recusa("O nome do follow-up tem de ter de 3 a 80 caracteres.");
  const mensagens = e.mensagens.map((m) => comAVariavelDoNome(m.trim())).filter(Boolean);
  if (mensagens.length !== 3) {
    return recusa("O follow-up do sistema é uma escada de TRÊS mensagens: escreva as três (a 2ª e a 3ª só saem se a pessoa não responder).");
  }
  if (mensagens.some((m) => m.length > 1000)) return recusa("Cada mensagem tem de ter até 1.000 caracteres.");
  const empresa = await lerEmpresaParaOModelo(c.db, c.organizationId);
  if (!empresa) return recusa("Não consegui ler a empresa.");
  const modelo = modeloDeRetomada(empresa.segmento);
  const { data } = await c.db.from("followup_flow_pointers").select("id, name").eq("organization_id", c.organizationId).limit(200);
  const ja = ((data ?? []) as Array<{ id: string; name: string }>).find((f) => chaveDoNome(f.name) === chaveDoNome(nome));
  if (ja) return recusa(`Já existe o follow-up «${ja.name}». Os textos mudam em Agente MIA › Follow-ups.`, "ja_existe", `/app/ai/followups/${ja.id}`);
  const esperas = esperasValidas(e.esperas_dias);
  const pedido: PedidoDeRascunhoDeFollowup = {
    nome,
    modelo,
    mensagens: [mensagens[0]!, mensagens[1]!, mensagens[2]!],
    esperas_dias: esperas,
  };
  return pronta({
    tipo: "rascunho_de_followup",
    titulo: `Escrever o rascunho do follow-up "${nome}"`,
    mudancas: [
      { rotulo: "Fluxo", valor: `${nome} · rascunho` },
      { rotulo: "1ª", valor: pedido.mensagens[0] },
      { rotulo: "2ª", valor: pedido.mensagens[1] },
      { rotulo: "3ª", valor: pedido.mensagens[2] },
      {
        rotulo: "Quando",
        valor: `depois de 24 h sem resposta; a 2ª ${esperas[0]} ${esperas[0] === 1 ? "dia" : "dias"} depois e a 3ª ${esperas[1]} dias depois, só se não responder`,
      },
    ],
    pedido,
    chave: chaveDoNome(nome),
  });
}

// ── item de conhecimento ────────────────────────────────────────────────────

/** O material do dia a dia, quando nenhum material de perguntas o agente no ar já lê. */
export const MATERIAL_DO_DIA_A_DIA = "Respostas do dia a dia";

interface MaterialLido {
  id: string;
  name: string;
  source_type: string;
}

export interface EntradaDeItemDeConhecimento {
  titulo: string;
  resposta: string;
  pergunta?: string | null;
}

export async function prepararItemDeConhecimento(c: ContextoDaPreparacao, e: EntradaDeItemDeConhecimento): Promise<Preparacao> {
  const titulo = e.titulo.trim().replace(/\s+/g, " ");
  const resposta = e.resposta.trim();
  const pergunta = (e.pergunta?.trim() || titulo).slice(0, 500);
  if (titulo.length < 2 || titulo.length > 120) return recusa("O título do item tem de ter de 2 a 120 caracteres.");
  if (resposta.length < 3 || resposta.length > 4000) return recusa("O texto do item tem de ter de 3 a 4.000 caracteres.");

  // O agente no ar (o padrão primeiro) e os materiais que a versão publicada lê.
  const { data: agentes } = await c.db
    .from("ai_agents")
    .select("id, name, is_default, published_version_id")
    .eq("organization_id", c.organizationId)
    .is("archived_at", null)
    .not("published_version_id", "is", null)
    .order("is_default", { ascending: false })
    .limit(10);
  const noAr = ((agentes ?? []) as Array<{ id: string; name: string; published_version_id: string }>)[0] ?? null;
  let lidos: string[] = [];
  if (noAr) {
    const { data: versao } = await c.db
      .from("ai_agent_versions")
      .select("knowledge_source_ids")
      .eq("organization_id", c.organizationId)
      .eq("id", noAr.published_version_id)
      .maybeSingle();
    lidos = ((versao as { knowledge_source_ids?: string[] | null } | null)?.knowledge_source_ids ?? []).filter(Boolean);
  }
  const { data: materiais } = await c.db
    .from("ai_knowledge_sources")
    .select("id, name, source_type")
    .eq("organization_id", c.organizationId)
    .eq("is_active", true)
    .limit(200);
  const faqs = ((materiais ?? []) as MaterialLido[]).filter((m) => m.source_type === "faq");
  const lidoPeloAgente = faqs.find((m) => lidos.includes(m.id)) ?? null;
  const doDiaADia = faqs.find((m) => chaveDoNome(m.name) === chaveDoNome(MATERIAL_DO_DIA_A_DIA)) ?? null;
  const material = lidoPeloAgente ?? doDiaADia;
  const agenteUsa = Boolean(noAr && material && lidos.includes(material.id));

  if (material) {
    const { data: itens } = await c.db
      .from("ai_faq_items")
      .select("question")
      .eq("organization_id", c.organizationId)
      .eq("knowledge_source_id", material.id)
      .limit(500);
    const ja = ((itens ?? []) as Array<{ question: string }>).find((i) => chaveDoNome(i.question) === chaveDoNome(pergunta));
    if (ja) return recusa(`O material «${material.name}» já tem o item «${ja.question}».`, "ja_existe", "/app/ai/knowledge/sources");
  }

  return pronta({
    tipo: "conhecimento",
    titulo: `Pôr no conhecimento: ${titulo}`,
    mudancas: [
      { rotulo: "Item", valor: `${titulo} · ligado` },
      { rotulo: "Pergunta", valor: pergunta },
      { rotulo: "Resposta", valor: resposta },
      { rotulo: "Material", valor: material ? material.name : `${MATERIAL_DO_DIA_A_DIA} (novo)` },
    ],
    pedido: {
      titulo,
      pergunta,
      resposta,
      material_id: material?.id ?? null,
      material_nome: material?.name ?? MATERIAL_DO_DIA_A_DIA,
      agente_nome: agenteUsa ? (noAr?.name ?? null) : null,
      agente_usa: agenteUsa,
    },
    chave: chaveDoNome(pergunta),
  });
}

// ── relatório ───────────────────────────────────────────────────────────────

export const ROTULO_DO_AGRUPAMENTO: Record<AgrupamentoDoRelatorio, string> = {
  origem: "origem",
  etapa: "etapa",
  resp: "pessoa da equipe",
};

export const ROTULO_DO_PERIODO: Record<PeriodoDoRelatorio, string> = {
  "7": "nos últimos 7 dias",
  "30": "nos últimos 30 dias",
  "90": "nos últimos 90 dias",
  mes: "neste mês",
  mesp: "no mês passado",
};

export interface EntradaDeRelatorio {
  nome: string;
  agrupar: AgrupamentoDoRelatorio;
  periodo?: PeriodoDoRelatorio | null;
  para?: ParaQuem | null;
}

export async function prepararRelatorio(c: ContextoDaPreparacao, e: EntradaDeRelatorio): Promise<Preparacao> {
  const nome = e.nome.trim().replace(/\s+/g, " ");
  if (nome.length < 3 || nome.length > 80) return recusa("O nome do relatório tem de ter de 3 a 80 caracteres.");
  const periodo: PeriodoDoRelatorio = e.periodo ?? "mes";
  const para: ParaQuem = e.para ?? "eu";
  let funilId: string | null = null;
  if (e.agrupar === "etapa") {
    const funil = await acharFunil(c, null);
    if (ehPreparacao(funil)) return funil;
    funilId = funil.id;
  }
  const { data } = await c.db.from("mia_relatorios").select("id, nome").eq("organization_id", c.organizationId).limit(500);
  const ja = ((data ?? []) as Array<{ id: string; nome: string }>).find((r) => chaveDoNome(r.nome) === chaveDoNome(nome));
  if (ja) return recusa(`Já existe o relatório «${ja.nome}».`, "ja_existe", "/app/relatorios");
  return pronta({
    tipo: "relatorio",
    titulo: `Montar o relatório "${nome}"`,
    mudancas: [
      { rotulo: "Relatório", valor: nome },
      { rotulo: "Mede", valor: `negócios, agrupados por ${ROTULO_DO_AGRUPAMENTO[e.agrupar]}, ${ROTULO_DO_PERIODO[periodo]}` },
      { rotulo: "Quem vê", valor: para === "eu" ? "só quem pediu" : "toda a equipe" },
    ],
    pedido: { nome, agrupar: e.agrupar, periodo, funil_id: funilId, para },
    chave: `${para === "eu" ? `eu:${c.userId}` : "equipe"}:${chaveDoNome(nome)}`,
  });
}

// ── meta do mês ─────────────────────────────────────────────────────────────

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function nomeDoMes(mes: string): string {
  const n = Number(mes.slice(5, 7));
  return MESES[n - 1] ?? mes;
}

function mesAnterior(mes: string): string {
  const ano = Number(mes.slice(0, 4));
  const n = Number(mes.slice(5, 7));
  return n === 1 ? `${ano - 1}-12` : `${ano}-${DOIS(n - 1)}`;
}

export function mesCorrente(fuso: string, agora: Date): string {
  const p = partesNoFuso(agora, fuso);
  return `${p.ano}-${DOIS(p.mes)}`;
}

export interface EntradaDeMeta {
  valor_cents: number;
  mes?: string | null;
}

export async function prepararMeta(c: ContextoDaPreparacao, e: EntradaDeMeta): Promise<Preparacao> {
  if (!roleAtLeast(c.papel, "manager")) {
    return recusa("Você não vê a meta da equipe pelo assistente, então eu não preparo. Quem vê e decide é o administrador.", "invalido");
  }
  if (!Number.isInteger(e.valor_cents) || e.valor_cents <= 0 || e.valor_cents > 1e12) return recusa("A meta tem de ser um valor maior que zero.");
  const mes = e.mes?.trim() || mesCorrente(c.fuso, c.agora);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return recusa('O mês vai como "AAAA-MM", por exemplo "2026-11".');
  if (mes < mesCorrente(c.fuso, c.agora)) return recusa("Esse mês já passou: a meta é do mês de agora ou de um que vem.");
  const { data: org } = await c.db.from("organizations").select("currency").eq("id", c.organizationId).maybeSingle();
  const moeda = ((org as { currency?: string | null } | null)?.currency || "BRL").toUpperCase();
  const lerAlvo = async (m: string): Promise<number | null> => {
    const { data } = await c.db
      .from("sales_targets")
      .select("alvo_cents")
      .eq("organization_id", c.organizationId)
      .eq("periodo", `${m}-01`)
      .eq("metrica", "receita_total")
      .is("user_id", null)
      .is("agent_id", null)
      .maybeSingle();
    const v = (data as { alvo_cents?: number | string | null } | null)?.alvo_cents;
    return v === null || v === undefined ? null : Number(v);
  };
  const [atual, anterior] = await Promise.all([lerAlvo(mes), lerAlvo(mesAnterior(mes))]);
  if (atual === e.valor_cents) return recusa(`A meta de ${nomeDoMes(mes)} já é ${formatarDinheiro(atual, moeda, c.idioma)}.`, "ja_existe", "/app/metrics");
  const dinheiro = (v: number) => formatarDinheiro(v, moeda, c.idioma);
  const antes =
    atual !== null
      ? dinheiro(atual)
      : `${nomeDoMes(mes)} sem meta${anterior !== null ? ` (a de ${nomeDoMes(mesAnterior(mes))} foi ${dinheiro(anterior)})` : ""}`;
  return pronta({
    tipo: "meta",
    titulo: `Definir a meta de ${nomeDoMes(mes)} em ${dinheiro(e.valor_cents)}`,
    mudancas: [
      { rotulo: "Antes", valor: antes },
      { rotulo: "Depois", valor: dinheiro(e.valor_cents) },
    ],
    pedido: { mes, valor_cents: e.valor_cents, moeda },
    chave: mes,
  });
}
