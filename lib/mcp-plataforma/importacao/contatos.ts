/**
 * IMPORTAR CONTATOS — a lista de pessoas de outro CRM.
 *
 * ── De onde vem cada regra ────────────────────────────────────────────────
 *
 * A plataforma já importa contatos por planilha (`POST /api/v1/contacts/import`),
 * e esta ferramenta usa as MESMAS peças que ela, para não existir uma segunda
 * régua do que é um contato:
 *
 *  - o TELEFONE passa por `normalizePhoneBR` (`lib/webhooks/inbound.ts`), a
 *    regra da casa: 10 ou 11 dígitos são DDD + número e ganham +55; celular
 *    brasileiro é guardado sempre COM o nono dígito;
 *  - a BUSCA do contato existente usa `phoneLookupVariants`
 *    (`lib/channels/phone-variants.ts`): o mesmo número com e sem o nono dígito
 *    é a mesma pessoa, e é essa a função que a ingestão do WhatsApp usa;
 *  - o que é um contato VÁLIDO é o `contactCreateSchema`, o schema do cadastro
 *    pela tela;
 *  - o insert é linha a linha, porque `contacts` tem índices únicos parciais e
 *    um insert em lote viraria tudo ou nada.
 *
 * ── No que ela difere da planilha, e por quê ──────────────────────────────
 *
 *  1. Quem já existe é ATUALIZADO, não pulado. Uma migração traz o que o CRM
 *     antigo sabia sobre quem já falou com o cliente pelo WhatsApp.
 *  2. Ela NÃO emite `contact.created` nem `contact.tag_added`. A planilha emite
 *     o primeiro, e a edição pela tela emite o segundo, que é gatilho de
 *     automação: uma regra "quando ganhar a etiqueta X, enviar mensagem"
 *     dispararia para a base inteira. Sem evento não há consumidor: nem os de
 *     hoje, nem os que nascerem depois.
 *  3. Ela não abre conversa. O cadastro pela tela abre uma (`ensureConversation`)
 *     para o atendente já poder escrever; numa migração isso encheria a caixa
 *     de entrada de conversas vazias.
 *
 * ── Opt-out ───────────────────────────────────────────────────────────────
 *
 * Quem veio marcado como opt-out entra BLOQUEADO (`contacts.is_blocked`), que é
 * o veto que todo envio do produto respeita. E a importação só bloqueia: quem
 * já está bloqueado na base continua bloqueado, mesmo que a lista diga o
 * contrário. Quem pediu para sair não é "reativado" por uma planilha.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { escolherContatoCanonico } from "@/lib/channels/contato-por-telefone";
import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import { normalizarTags } from "@/lib/contacts/tag-normalizada";
import { contactCreateSchema } from "@/lib/schemas/contacts";
import { apenasDigitos } from "@/lib/schemas/empresas";
import { normalizePhoneBR } from "@/lib/webhooks/inbound";

import {
  Coletor,
  dataDeOrigem,
  ehObjeto,
  explicarProblemaDoSchema,
  listaDeItens,
  mesmoValor,
  modoQuandoJaExiste,
  organizacaoDaImportacao,
  origemDaImportacao,
  registrarImportacao,
  requestIdDe,
  somarEtiquetas,
  sourceDaImportacao,
  texto,
} from "./base";
import { redigirLote } from "./auditoria";
import { EmpresasDaBase } from "./empresas";
import { OPERACAO_IMPORTAR_BASE } from "./operacoes";
import type { ContextoDaFerramenta, FerramentaDeImportacao, QuandoJaExiste, ResultadoDoLote } from "./tipos";

export const TETO_DE_CONTATOS = 200;

/** O mesmo corte da importação por planilha. */
export const TETO_DE_ETIQUETAS = 20;

/** Como o opt-out importado fica registrado em `contacts.blocked_reason`. */
export const MOTIVO_DO_OPT_OUT_IMPORTADO = "opt_out_importado";

const PAPEIS = ["decisor", "financeiro", "usuario", "influenciador", "outro"] as const;

const COLUNAS =
  "id, name, display_name, email, email_normalized, phone_number, tags, custom_fields, consent, " +
  "is_blocked, is_anonymized, is_merged_into, empresa_id, cargo, setor, papel_na_empresa, principal_na_empresa";

export interface ContatoNaBase {
  id: string;
  name: string | null;
  display_name: string | null;
  email: string | null;
  email_normalized: string | null;
  phone_number: string | null;
  tags: string[] | null;
  custom_fields: Record<string, unknown> | null;
  consent: Record<string, unknown> | null;
  is_blocked: boolean;
  is_anonymized: boolean;
  is_merged_into: string | null;
  empresa_id: string | null;
  cargo: string | null;
  setor: string | null;
  papel_na_empresa: string | null;
  principal_na_empresa: boolean;
}

export const EXEMPLO_DE_CONTATO = {
  nome: "Ana Souza",
  telefone: "(11) 99999-8888",
  email: "ana.souza@exemplo.invalid",
  etiquetas: ["cliente antigo"],
  canal: "indicação",
  campos: { cidade: "Belo Horizonte" },
  observacao: "Prefere contato à tarde.",
  empresa: { cnpj: "12.345.678/0001-90", nome: "Padaria Modelo LTDA", cargo: "Compradora", papel: "decisor", principal: true },
  consentimento_marketing: "concedido",
  consentimento_em: "2026-03-14",
  opt_out: false,
  id_de_origem: "c-1042",
};

const CAMPO_DO_CONTATO: Record<string, string> = {
  name: "nome",
  phone_number: "telefone",
  email: "email",
  tags: "etiquetas",
  custom_fields: "campos",
  cargo: "empresa.cargo",
  setor: "empresa.setor",
  papel_na_empresa: "empresa.papel",
  principal_na_empresa: "empresa.principal",
};

const EXEMPLO_POR_CAMPO: Record<string, string> = {
  nome: '"Ana Souza"',
  telefone: '"(11) 99999-8888" ou "+5511999998888"',
  email: '"ana.souza@exemplo.invalid"',
  etiquetas: '["cliente antigo", "atacado"]',
  campos: '{ "cidade": "Belo Horizonte" }',
  "empresa.papel": `"decisor" (aceita: ${PAPEIS.join(", ")})`,
};

// ── achar quem já existe ──────────────────────────────────────────────────

/**
 * O contato VIVO que tem este telefone, com ou sem o nono dígito.
 *
 * Mesmo filtro e mesma escolha de `encontrarContatoPorTelefone`
 * (`lib/channels/contato-por-telefone.ts`); a diferença é só o conjunto de
 * colunas, que aqui precisa do contato inteiro para comparar.
 */
export async function acharContatoPorTelefone(
  admin: SupabaseClient,
  orgId: string,
  telefone: string,
): Promise<ContatoNaBase | null> {
  const variantes = phoneLookupVariants(telefone);
  if (variantes.length === 0) return null;
  const { data, error } = await admin
    .from("contacts")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .in("phone_number", variantes)
    .is("is_merged_into", null)
    .limit(4);
  if (error) throw new Error(`não consegui procurar o contato pelo telefone: ${error.message}`);
  return escolherContatoCanonico((data ?? []) as unknown as ContatoNaBase[], telefone);
}

/** O contato VIVO que tem este e-mail, sem diferenciar maiúsculas. */
export async function acharContatoPorEmail(
  admin: SupabaseClient,
  orgId: string,
  email: string,
): Promise<ContatoNaBase | null> {
  const { data, error } = await admin
    .from("contacts")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .eq("email_normalized", email.trim().toLowerCase())
    .is("is_merged_into", null)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`não consegui procurar o contato pelo e-mail: ${error.message}`);
  return ((data ?? []) as unknown as ContatoNaBase[])[0] ?? null;
}

// ── consentimento ─────────────────────────────────────────────────────────

type Consentimento = "concedido" | "recusado";

interface Finalidade {
  granted_at?: string | null;
  declined_at?: string | null;
  source?: string | null;
  version?: string | null;
}

function finalidadeDeMarketing(consent: Record<string, unknown> | null | undefined): Finalidade {
  const m = consent?.marketing;
  return ehObjeto(m) ? (m as Finalidade) : {};
}

const FINALIDADE_VAZIA = { granted_at: null, source: null, version: null };

/**
 * O `consent` que a importação grava, na forma que o produto já lê.
 *
 * Concedido é `marketing.granted_at`; RECUSADO é `marketing.declined_at`, um
 * fato positivo, que é o que as guardas de envio consultam
 * (`lib/automation/guarda-do-contato.ts`). As outras duas finalidades ficam
 * como o banco as cria: a importação só sabe de marketing.
 */
export function consentDaImportacao(
  estado: Consentimento,
  quando: string,
  origem: string,
  atual: Record<string, unknown> | null,
): Record<string, unknown> {
  const base = {
    transactional: FINALIDADE_VAZIA,
    profiling: FINALIDADE_VAZIA,
    ...(atual ?? {}),
  };
  const fonte = sourceDaImportacao(origem);
  return {
    ...base,
    marketing:
      estado === "concedido"
        ? { granted_at: quando, source: fonte, version: null }
        : { granted_at: null, declined_at: quando, source: fonte, version: null },
  };
}

// ── ler um item ───────────────────────────────────────────────────────────

interface EmpresaDoItem {
  nome: string | null;
  cnpj: string | null;
}

export interface ContatoLido {
  name: string | null;
  phone_number: string | null;
  email: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  canal: string | null;
  observacao: string | null;
  empresa: EmpresaDoItem | null;
  cargo: string | null;
  setor: string | null;
  papel_na_empresa: string | null;
  principal_na_empresa: boolean | null;
  consentimento: Consentimento | null;
  consentimento_em: string | null;
  opt_out: boolean;
  id_de_origem: string | null;
  avisos: string[];
}

type Leitura =
  | { ok: true; contato: ContatoLido }
  | { ok: false; campo: string; esperado: string; exemplo?: string };

const emailValido = z.string().email();

function booleano(valor: unknown): boolean | null {
  if (typeof valor === "boolean") return valor;
  if (typeof valor !== "string") return null;
  const v = valor.trim().toLowerCase();
  if (["sim", "s", "true", "1", "yes"].includes(v)) return true;
  if (["nao", "não", "n", "false", "0", "no"].includes(v)) return false;
  return null;
}

/**
 * Lê e valida UM contato. Puro: não toca o banco.
 *
 * Telefone inválido com e-mail válido NÃO recusa o contato: ele entra pelo
 * e-mail e a resposta avisa. O que recusa é não sobrar identificador nenhum,
 * porque um contato sem telefone e sem e-mail não pode ser reconhecido na
 * próxima rodada e viraria duplicata de si mesmo.
 */
export function lerContato(item: unknown): Leitura {
  if (!ehObjeto(item)) {
    return {
      ok: false,
      campo: "(item)",
      esperado: "cada contato é um objeto com telefone ou e-mail.",
      exemplo: JSON.stringify({ nome: "Ana Souza", telefone: "(11) 99999-8888" }),
    };
  }
  const avisos: string[] = [];

  const telefoneBruto = texto(item.telefone, 60);
  const telefone = telefoneBruto ? normalizePhoneBR(telefoneBruto) : null;
  const emailBruto = texto(item.email, 320);
  const email = emailBruto && emailValido.safeParse(emailBruto).success ? emailBruto : null;

  if (!telefone && !email) {
    if (telefoneBruto) {
      return {
        ok: false,
        campo: "telefone",
        esperado:
          "o telefone não é um número válido e o contato não tem e-mail. Esperado DDD + número " +
          "(10 ou 11 dígitos), com ou sem +55 e com ou sem máscara; número de outro país precisa do + e do DDI.",
        exemplo: EXEMPLO_POR_CAMPO.telefone,
      };
    }
    if (emailBruto) {
      return {
        ok: false,
        campo: "email",
        esperado: "o e-mail não é válido e o contato não tem telefone.",
        exemplo: EXEMPLO_POR_CAMPO.email,
      };
    }
    return {
      ok: false,
      campo: "telefone",
      esperado: "o contato precisa de um telefone válido ou de um e-mail: sem nenhum dos dois ele não é reconhecido numa próxima importação.",
      exemplo: EXEMPLO_POR_CAMPO.telefone,
    };
  }
  if (telefoneBruto && !telefone) {
    avisos.push("O telefone não é um número válido e foi ignorado: o contato entrou só com o e-mail.");
  }
  if (emailBruto && !email) {
    avisos.push("O e-mail não é válido e foi ignorado: o contato entrou só com o telefone.");
  }

  // Etiquetas: a mesma normalização da tela (minúsculas, até 40 caracteres) e o
  // mesmo teto da planilha. O que passa do teto é DITO, não descartado calado.
  let tags: string[] = [];
  if (item.etiquetas !== undefined && item.etiquetas !== null) {
    if (!Array.isArray(item.etiquetas) || item.etiquetas.some((e) => typeof e !== "string")) {
      return { ok: false, campo: "etiquetas", esperado: "deveria ser uma lista de textos.", exemplo: EXEMPLO_POR_CAMPO.etiquetas };
    }
    tags = normalizarTags(item.etiquetas as string[]);
    if (tags.length > TETO_DE_ETIQUETAS) {
      avisos.push(`Vieram ${tags.length} etiquetas e o teto é ${TETO_DE_ETIQUETAS} por contato: as últimas ficaram de fora.`);
      tags = tags.slice(0, TETO_DE_ETIQUETAS);
    }
  }

  if (item.campos !== undefined && item.campos !== null && !ehObjeto(item.campos)) {
    return { ok: false, campo: "campos", esperado: "deveria ser um objeto de campo e valor.", exemplo: EXEMPLO_POR_CAMPO.campos };
  }

  // A empresa do contato: quem ela é (para ligar) e o que a pessoa é nela.
  let empresa: EmpresaDoItem | null = null;
  let cargo: string | null = null;
  let setor: string | null = null;
  let papel: string | null = null;
  let principal: boolean | null = null;
  if (item.empresa !== undefined && item.empresa !== null) {
    if (!ehObjeto(item.empresa)) {
      return {
        ok: false,
        campo: "empresa",
        esperado: "deveria ser um objeto com `cnpj` e/ou `nome` da empresa.",
        exemplo: JSON.stringify(EXEMPLO_DE_CONTATO.empresa),
      };
    }
    const e = item.empresa;
    const cnpj = apenasDigitos(texto(e.cnpj, 40) ?? "");
    const nomeDaEmpresa = texto(e.nome, 200);
    if (cnpj && cnpj.length !== 14) {
      avisos.push("O CNPJ da empresa não tem 14 dígitos e foi ignorado" + (nomeDaEmpresa ? ": procurei a empresa pelo nome." : "."));
    }
    const cnpjUsavel = cnpj.length === 14 ? cnpj : null;
    if (cnpjUsavel || nomeDaEmpresa) empresa = { nome: nomeDaEmpresa, cnpj: cnpjUsavel };
    cargo = texto(e.cargo, 120);
    setor = texto(e.setor, 120);
    const papelBruto = texto(e.papel, 40)?.toLowerCase() ?? null;
    if (papelBruto) {
      const semAcento = papelBruto.normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (!(PAPEIS as readonly string[]).includes(semAcento)) {
        return {
          ok: false,
          campo: "empresa.papel",
          esperado: `aceita só: ${PAPEIS.join(", ")}.`,
          exemplo: EXEMPLO_POR_CAMPO["empresa.papel"],
        };
      }
      papel = semAcento;
    }
    principal = e.principal === undefined || e.principal === null ? null : booleano(e.principal);
  }

  let consentimento: Consentimento | null = null;
  const consentBruto = texto(item.consentimento_marketing, 40)?.toLowerCase() ?? null;
  if (consentBruto) {
    if (consentBruto !== "concedido" && consentBruto !== "recusado") {
      return {
        ok: false,
        campo: "consentimento_marketing",
        esperado: 'aceita só "concedido" ou "recusado". Sem informação no CRM de origem, não mande o campo.',
        exemplo: '"concedido"',
      };
    }
    consentimento = consentBruto;
  }
  let consentimentoEm: string | null = null;
  if (item.consentimento_em !== undefined && item.consentimento_em !== null && item.consentimento_em !== "") {
    consentimentoEm = dataDeOrigem(item.consentimento_em);
    if (!consentimentoEm) {
      return {
        ok: false,
        campo: "consentimento_em",
        esperado: "deveria ser uma data.",
        exemplo: '"2026-03-14" ou "14/03/2026"',
      };
    }
  }

  let optOut = false;
  if (item.opt_out !== undefined && item.opt_out !== null && item.opt_out !== "") {
    const lido = booleano(item.opt_out);
    if (lido === null) {
      return {
        ok: false,
        campo: "opt_out",
        esperado: "deveria ser verdadeiro ou falso (true = a pessoa pediu para não receber mensagens).",
        exemplo: "true",
      };
    }
    optOut = lido;
  }

  const nome = texto(item.nome, 400);
  const candidato: Record<string, unknown> = {
    ...(nome ? { name: nome } : {}),
    ...(telefone ? { phone_number: telefone } : {}),
    ...(email ? { email } : {}),
    tags,
    ...(item.campos ? { custom_fields: item.campos } : {}),
    ...(cargo ? { cargo } : {}),
    ...(setor ? { setor } : {}),
  };
  // O MESMO schema do cadastro pela tela: tamanho do nome, forma do telefone,
  // teto de 32 KB nos campos personalizados.
  const parsed = contactCreateSchema.safeParse(candidato);
  if (!parsed.success) {
    const problema = explicarProblemaDoSchema(parsed.error.issues[0]!, CAMPO_DO_CONTATO);
    return { ok: false, ...problema, exemplo: EXEMPLO_POR_CAMPO[problema.campo] };
  }

  return {
    ok: true,
    contato: {
      name: parsed.data.name ?? null,
      phone_number: parsed.data.phone_number ?? null,
      email: parsed.data.email ?? null,
      tags: parsed.data.tags ?? [],
      custom_fields: (parsed.data.custom_fields as Record<string, unknown> | undefined) ?? {},
      canal: texto(item.canal, 120),
      observacao: texto(item.observacao, 4000),
      empresa,
      cargo: parsed.data.cargo ?? null,
      setor: parsed.data.setor ?? null,
      papel_na_empresa: papel,
      principal_na_empresa: principal,
      consentimento,
      consentimento_em: consentimentoEm,
      opt_out: optOut,
      id_de_origem: texto(item.id_de_origem, 200),
      avisos,
    },
  };
}

// ── o que muda num contato que já existe ──────────────────────────────────

/**
 * O patch de um contato que já está na base, e o que ficou de fora.
 *
 * Três coisas não seguem o modo, porque errar nelas não tem volta barata:
 *
 *  - o TELEFONE de um contato que já tem um nunca é trocado. Ele é a identidade
 *    da pessoa no WhatsApp; trocar ligaria a conversa de alguém ao cadastro de
 *    outro;
 *  - o OPT-OUT só liga. Quem está bloqueado continua bloqueado;
 *  - a RECUSA de marketing vale sempre, e a concessão nunca passa por cima de
 *    uma recusa registrada.
 */
export function mudancasDoContato(
  atual: ContatoNaBase,
  novo: ContatoLido,
  modo: QuandoJaExiste,
  contexto: { empresaId: string | null; origem: string; agora: string; emailLivre: boolean; telefoneLivre: boolean },
): { patch: Record<string, unknown>; naoAplicados: string[]; avisos: string[] } {
  const patch: Record<string, unknown> = {};
  const naoAplicados: string[] = [];
  const avisos: string[] = [];

  const escalar = (coluna: keyof ContatoNaBase, veio: string | null, rotulo: string) => {
    if (!veio) return;
    const havia = (typeof atual[coluna] === "string" ? (atual[coluna] as string) : "").trim();
    if (veio === havia) return;
    if (!havia || modo === "atualizar") patch[coluna] = veio;
    else naoAplicados.push(rotulo);
  };

  escalar("name", novo.name, "nome");

  if (novo.email && (atual.email_normalized ?? atual.email ?? "").toLowerCase() !== novo.email.toLowerCase()) {
    if (!contexto.emailLivre) {
      avisos.push(
        "O e-mail desta linha já é de OUTRO contato da base: não foi gravado aqui. Podem ser a mesma pessoa cadastrada " +
          "duas vezes; confira em Contatos › Duplicados.",
      );
    } else if (!atual.email || modo === "atualizar") {
      patch.email = novo.email;
    } else {
      naoAplicados.push("email");
    }
  }

  if (novo.phone_number && !atual.phone_number) {
    if (contexto.telefoneLivre) patch.phone_number = novo.phone_number;
    else {
      avisos.push(
        "O telefone desta linha já é de OUTRO contato da base: não foi gravado aqui. Podem ser a mesma pessoa cadastrada " +
          "duas vezes; confira em Contatos › Duplicados.",
      );
    }
  } else if (
    novo.phone_number &&
    atual.phone_number &&
    !phoneLookupVariants(atual.phone_number).includes(novo.phone_number)
  ) {
    avisos.push(
      "O contato já tem outro telefone na base, e o telefone de um contato nunca é trocado pela importação. Troque pela tela, se for o caso.",
    );
  }

  const etiquetas = somarEtiquetas(atual.tags ?? [], novo.tags);
  if (etiquetas.length !== (atual.tags ?? []).length) patch.tags = etiquetas;

  const camposAtuais = atual.custom_fields ?? {};
  const camposNovos: Record<string, unknown> = { ...camposAtuais };
  let mudouCampo = false;
  for (const [chave, valor] of Object.entries(novo.custom_fields)) {
    if (!(chave in camposAtuais)) {
      camposNovos[chave] = valor;
      mudouCampo = true;
    } else if (!mesmoValor(camposAtuais[chave], valor)) {
      if (modo === "atualizar") {
        camposNovos[chave] = valor;
        mudouCampo = true;
      } else {
        naoAplicados.push(`campos.${chave}`);
      }
    }
  }
  if (mudouCampo) patch.custom_fields = camposNovos;

  if (contexto.empresaId && contexto.empresaId !== atual.empresa_id) {
    if (!atual.empresa_id || modo === "atualizar") patch.empresa_id = contexto.empresaId;
    else naoAplicados.push("empresa");
  }
  escalar("cargo", novo.cargo, "empresa.cargo");
  escalar("setor", novo.setor, "empresa.setor");
  escalar("papel_na_empresa", novo.papel_na_empresa, "empresa.papel");
  if (novo.principal_na_empresa !== null && novo.principal_na_empresa !== atual.principal_na_empresa) {
    // `false` é o valor de quem nunca foi marcado: ligar o principal é
    // completar; desligar é trocar, e só o modo "atualizar" troca.
    if (novo.principal_na_empresa || modo === "atualizar") patch.principal_na_empresa = novo.principal_na_empresa;
    else naoAplicados.push("empresa.principal");
  }

  if (novo.consentimento) {
    const marketing = finalidadeDeMarketing(atual.consent);
    const quando = novo.consentimento_em ?? contexto.agora;
    if (novo.consentimento === "recusado") {
      if (!marketing.declined_at) patch.consent = consentDaImportacao("recusado", quando, contexto.origem, atual.consent);
    } else if (marketing.declined_at) {
      avisos.push(
        "A base registra que esta pessoa RECUSOU receber comunicação de marketing. A recusa foi mantida: a importação não a desfaz.",
      );
    } else if (!marketing.granted_at) {
      patch.consent = consentDaImportacao("concedido", quando, contexto.origem, atual.consent);
    }
  }

  if (novo.opt_out && !atual.is_blocked) {
    patch.is_blocked = true;
    patch.blocked_reason = MOTIVO_DO_OPT_OUT_IMPORTADO;
    patch.blocked_at = contexto.agora;
  }

  return { patch, naoAplicados, avisos };
}

// ── a observação ──────────────────────────────────────────────────────────

/** A manchete da nota que guarda a observação trazida do outro sistema. */
export function mancheteDaObservacao(origem: string): string {
  return `Observação trazida de ${origem}`;
}

/**
 * Grava a observação do CRM de origem como nota do contato (`lead_notes`).
 *
 * É a ÚNICA caixa de texto livre sobre uma pessoa que o produto já mostra na
 * ficha do contato, já inclui no relatório da LGPD e já apaga na anonimização.
 * É também a memória que o agente de IA lê sobre aquela pessoa: a observação do
 * CRM antigo passa a ser contexto do atendimento, e nunca é enviada a ninguém.
 *
 * Uma nota por contato e por origem: repetir a importação não empilha notas.
 */
async function gravarObservacao(
  admin: SupabaseClient,
  orgId: string,
  contatoId: string,
  origem: string,
  corpo: string,
  modo: QuandoJaExiste,
): Promise<"criou" | "atualizou" | "igual" | "manteve"> {
  const manchete = mancheteDaObservacao(origem);
  const { data, error } = await admin
    .from("lead_notes")
    .select("id, body")
    .eq("organization_id", orgId)
    .eq("contact_id", contatoId)
    .eq("headline", manchete)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`não consegui ler as notas do contato: ${error.message}`);
  const existente = ((data ?? []) as Array<{ id: string; body: string }>)[0];

  if (!existente) {
    const { error: erroInsert } = await admin
      .from("lead_notes")
      .insert({ organization_id: orgId, contact_id: contatoId, headline: manchete, body: corpo });
    if (erroInsert) throw new Error(`não consegui gravar a observação: ${erroInsert.message}`);
    return "criou";
  }
  if (existente.body === corpo) return "igual";
  if (modo !== "atualizar") return "manteve";
  const { error: erroUpdate } = await admin
    .from("lead_notes")
    .update({ body: corpo, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", existente.id);
  if (erroUpdate) throw new Error(`não consegui atualizar a observação: ${erroUpdate.message}`);
  return "atualizou";
}

// ── a importação ──────────────────────────────────────────────────────────

/** Os contatos que esta chamada já gravou: a mesma pessoa duas vezes na lista é UM contato. */
class JaVistosNoLote {
  private readonly porTelefone = new Map<string, ContatoNaBase>();
  private readonly porEmail = new Map<string, ContatoNaBase>();

  lembrar(contato: ContatoNaBase): void {
    if (contato.phone_number) {
      for (const v of phoneLookupVariants(contato.phone_number)) this.porTelefone.set(v, contato);
    }
    const email = (contato.email_normalized ?? contato.email ?? "").toLowerCase();
    if (email) this.porEmail.set(email, contato);
  }

  doTelefone(telefone: string): ContatoNaBase | null {
    for (const v of phoneLookupVariants(telefone)) {
      const achado = this.porTelefone.get(v);
      if (achado) return achado;
    }
    return null;
  }

  doEmail(email: string): ContatoNaBase | null {
    return this.porEmail.get(email.toLowerCase()) ?? null;
  }
}

export async function importarContatos(
  ctx: ContextoDaFerramenta,
  args: Record<string, unknown>,
): Promise<ResultadoDoLote> {
  const organizacao = await organizacaoDaImportacao(ctx.admin, args.organization_id);
  const itens = listaDeItens(args, "contatos", TETO_DE_CONTATOS, EXEMPLO_DE_CONTATO);
  const modo = modoQuandoJaExiste(args.quando_ja_existe);
  const origem = origemDaImportacao(args.origem, true) as string;
  const requestId = requestIdDe(ctx);
  const orgId = organizacao.id;

  const coletor = new Coletor();
  const vistos = new JaVistosNoLote();
  // As empresas só são lidas se algum item pedir vínculo.
  let empresas: EmpresasDaBase | null = null;

  for (let i = 0; i < itens.length; i += 1) {
    const posicao = i + 1;
    const lido = lerContato(itens[i]);
    if (!lido.ok) {
      coletor.recusar(posicao, lido.campo, lido.esperado, lido.exemplo);
      continue;
    }
    const novo = lido.contato;
    const avisos = [...novo.avisos];
    const agora = new Date().toISOString();

    try {
      // A empresa precisa EXISTIR: a importação de contatos não cria empresa.
      // Criar aqui faria uma ficha nascer de um nome digitado numa coluna de
      // contato, sem CNPJ e sem os dados que a lista de empresas traria.
      let empresaId: string | null = null;
      if (novo.empresa) {
        empresas ??= await EmpresasDaBase.carregar(ctx, orgId);
        const achada = empresas.achar(novo.empresa.nome, novo.empresa.cnpj).empresa;
        if (achada) empresaId = achada.id;
        else {
          avisos.push(
            "A empresa deste contato não está na base, e o contato entrou sem o vínculo. Importe a empresa com " +
              "plataforma_importar_empresas e repita esta chamada: a reexecução faz a ligação.",
          );
        }
      }

      const peloTelefone = novo.phone_number
        ? (vistos.doTelefone(novo.phone_number) ?? (await acharContatoPorTelefone(ctx.admin, orgId, novo.phone_number)))
        : null;
      const peloEmail = novo.email
        ? (vistos.doEmail(novo.email) ?? (await acharContatoPorEmail(ctx.admin, orgId, novo.email)))
        : null;
      // O telefone manda: é a identidade da pessoa no canal em que o produto atende.
      const existente = peloTelefone ?? peloEmail;

      if (existente?.is_anonymized) {
        coletor.recusar(
          posicao,
          novo.phone_number ? "telefone" : "email",
          "este contato foi ANONIMIZADO a pedido do titular (LGPD) e não é reimportado. Tire-o da lista.",
        );
        continue;
      }

      if (existente) {
        const { patch, naoAplicados, avisos: avisosDoPatch } = mudancasDoContato(existente, novo, modo, {
          empresaId,
          origem,
          agora,
          emailLivre: !peloEmail || peloEmail.id === existente.id,
          telefoneLivre: !peloTelefone || peloTelefone.id === existente.id,
        });
        avisos.push(...avisosDoPatch);
        if (naoAplicados.length > 0) {
          avisos.push(
            `A base já tem outro valor em: ${naoAplicados.join(", ")}. Mantive o que estava. ` +
              'Para substituir, repita com quando_ja_existe: "atualizar".',
          );
        }
        if (existente.is_blocked && !novo.opt_out) {
          avisos.push("Este contato está BLOQUEADO na base (pediu para não receber mensagens) e continua bloqueado.");
        }

        let mudou = false;
        let naBase: ContatoNaBase = existente;
        if (Object.keys(patch).length > 0) {
          const { data, error } = await ctx.admin
            .from("contacts")
            .update({ ...patch, updated_at: agora })
            .eq("organization_id", orgId)
            .eq("id", existente.id)
            .select(COLUNAS)
            .maybeSingle();
          if (error || !data) {
            coletor.recusar(
              posicao,
              "(gravação)",
              error?.code === "23505"
                ? "o telefone ou o e-mail desta linha já pertence a outro contato da base."
                : `o banco recusou a atualização: ${error?.message ?? "o contato não está mais na base"}.`,
            );
            continue;
          }
          naBase = data as unknown as ContatoNaBase;
          mudou = true;
        }
        if (novo.observacao) {
          const nota = await gravarObservacao(ctx.admin, orgId, existente.id, origem, novo.observacao, modo);
          if (nota === "criou" || nota === "atualizou") mudou = true;
          if (nota === "manteve") {
            avisos.push(
              'A observação trazida deste sistema já existe com outro texto e foi mantida. Para trocar, repita com quando_ja_existe: "atualizar".',
            );
          }
        }
        vistos.lembrar(naBase);
        coletor.registrar(posicao, mudou ? "atualizou" : "ja_estava", { id: existente.id, avisos });
        continue;
      }

      const { data, error } = await ctx.admin
        .from("contacts")
        .insert({
          organization_id: orgId,
          created_by_user_id: ctx.autorUserId,
          name: novo.name,
          email: novo.email,
          phone_number: novo.phone_number,
          tags: novo.tags,
          source: sourceDaImportacao(origem),
          source_metadata: {
            importacao: {
              origem,
              ...(novo.id_de_origem ? { id_de_origem: novo.id_de_origem } : {}),
              ...(novo.canal ? { canal: novo.canal } : {}),
              importado_em: agora,
            },
          },
          custom_fields: novo.custom_fields,
          empresa_id: empresaId,
          cargo: novo.cargo,
          setor: novo.setor,
          papel_na_empresa: novo.papel_na_empresa,
          principal_na_empresa: novo.principal_na_empresa ?? false,
          // Sem informação de consentimento, a coluna fica com o padrão do banco.
          ...(novo.consentimento
            ? { consent: consentDaImportacao(novo.consentimento, novo.consentimento_em ?? agora, origem, null) }
            : {}),
          ...(novo.opt_out
            ? { is_blocked: true, blocked_reason: MOTIVO_DO_OPT_OUT_IMPORTADO, blocked_at: agora }
            : {}),
        })
        .select(COLUNAS)
        .single();
      if (error || !data) {
        coletor.recusar(
          posicao,
          "(gravação)",
          error?.code === "23505"
            ? "já existe um contato com este telefone ou e-mail, gravado enquanto esta importação rodava. Repita a chamada: ele será reconhecido."
            : `o banco recusou a criação: ${error?.message ?? "sem linha"}.`,
        );
        continue;
      }
      const criado = data as unknown as ContatoNaBase;
      if (novo.observacao) await gravarObservacao(ctx.admin, orgId, criado.id, origem, novo.observacao, modo);
      vistos.lembrar(criado);
      coletor.registrar(posicao, "criou", { id: criado.id, avisos });
    } catch (err) {
      coletor.recusar(posicao, "(gravação)", err instanceof Error ? `${err.message}.` : "falha inesperada.");
    }
  }

  await registrarImportacao(ctx, {
    organizacao,
    ferramenta: "plataforma_importar_contatos",
    tipo: "contatos",
    origem,
    coletor,
    requestId,
    extra: { quando_ja_existe: modo },
  });

  return coletor.resultado(organizacao);
}

export const FERRAMENTA_IMPORTAR_CONTATOS: FerramentaDeImportacao = {
  name: "plataforma_importar_contatos",
  description:
    "Importa CONTATOS (as pessoas) da base de outro CRM para um cliente da plataforma. É o passo 4 de uma migração: " +
    "equipe → funis → empresas → contatos → negócios → materiais. Importe as empresas antes, se os contatos têm empresa.\n\n" +
    `Teto: ${TETO_DE_CONTATOS} contatos por chamada. Lista maior: chame várias vezes; a resposta traz as contagens.\n\n` +
    "Pode ser repetida sem duplicar. O contato é reconhecido pelo TELEFONE (o mesmo número com e sem o nono dígito, com e " +
    "sem +55, com e sem máscara é a mesma pessoa) e, sem telefone, pelo E-MAIL (maiúsculas não diferenciam). Quem já existe " +
    "é atualizado, não duplicado. A resposta diz, item a item (posição começando em 1), se criou, atualizou, já estava igual " +
    "ou recusou e por quê. Contato sem telefone válido E sem e-mail é recusado. Um item ruim não derruba os outros.\n\n" +
    "O que NÃO faz: não envia mensagem, não inscreve em follow-up, não dispara automação (nem a de etiqueta), não abre conversa, " +
    "não cria empresa, não troca o telefone de quem já tem um e nunca tira o bloqueio de quem pediu para sair. Quem vier com " +
    "opt_out: true entra bloqueado para todo envio.\n\n" +
    "Só importe base que o cliente tem direito de usar (LGPD): pessoas com quem ele tem relação ou que consentiram.",
  inputSchema: {
    organization_id: z.string().describe("O id do cliente que recebe a base (de plataforma_listar_clientes)."),
    origem: z
      .string()
      .describe(
        'De qual sistema a base vem, em minúsculas e sem espaço (ex.: "rdstation", "pipedrive", "planilha"). ' +
          "Use sempre o mesmo nome: ele marca a origem do contato e da observação.",
      ),
    contatos: z
      .array(z.unknown())
      .describe(
        `Até ${TETO_DE_CONTATOS} contatos. Cada um: nome, telefone e/ou email (pelo menos um dos dois), etiquetas (lista), ` +
          "canal (por onde a pessoa chegou no CRM antigo), campos (objeto com campos personalizados), observacao (texto livre; " +
          "vira nota do contato, que a equipe e o agente de IA leem), empresa ({ cnpj e/ou nome, cargo, setor, papel: " +
          `${PAPEIS.join("|")}, principal: true|false }), consentimento_marketing ("concedido"|"recusado"), consentimento_em (data), ` +
          "opt_out (true = pediu para não receber mensagens) e id_de_origem. " +
          `Exemplo: ${JSON.stringify(EXEMPLO_DE_CONTATO)}`,
      ),
    quando_ja_existe: z
      .string()
      .optional()
      .describe(
        '"completar" (padrão): só preenche o que está vazio no contato que já existe. "atualizar": o que veio preenchido ' +
          "substitui o que havia. Nos dois, etiqueta só soma, telefone nunca é trocado e nada é apagado.",
      ),
  },
  operacao: OPERACAO_IMPORTAR_BASE,
  exemplo: { organization_id: "00000000-0000-4000-8000-000000000001", origem: "rdstation", contatos: [EXEMPLO_DE_CONTATO] },
  handler: importarContatos,
  redigirParaAuditoria: redigirLote(["organization_id", "origem", "quando_ja_existe"], ["contatos"]),
};
