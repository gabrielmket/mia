/**
 * FORK MIA (.91) · O RÓTULO DO CLIENTE — o "o que falta" de uma empresa nova.
 *
 * É o checklist do MCP (`plataforma_ver_implantacao`) lido com os olhos de quem
 * entrou sozinho: as mesmas áreas, na mesma régua, viradas nas três colunas do
 * desenho do upstream (#1941 e a fase 3 do #2860) e na linha "não se aplica":
 *
 *   preenchido         já está de pé
 *   posso_completar    o assistente prepara como proposta, e a administradora
 *                      aprova (só três peças: agente, funil e follow-up)
 *   preciso_confirmar  só uma pessoa faz, pela tela (canal, publicar, convite,
 *                      pagamento, ensaio) ou a Time Company faz (o número
 *                      oficial pelo Facebook)
 *
 * NÃO existe uma segunda régua: esta função não lê o banco. Ela recebe as áreas
 * já avaliadas (`avaliarAreas`) e só decide a coluna, o texto e a dependência
 * de cada item. Quando o upstream construir a auditoria dele, troca-se a fonte,
 * não a tela.
 *
 * Os textos vão com as variáveis separadas (`{ texto, vars }`): a tela traduz o
 * texto e encaixa os nomes; o MCP e o assistente usam o texto já montado.
 */
import { modeloPorId } from "@/lib/followup/modelos";
import { roleAtLeast, type Role } from "@/lib/auth/types";
import {
  modeloDoSegmento,
  pacoteDoSegmento,
  type SegmentoDoOnboarding,
} from "@/lib/onboarding/modelos-de-agente-da-mia";

import type { AreaAvaliada } from "./avaliar";

/** As áreas do checklist que o rótulo do cliente lê. */
export const AREAS_DO_ROTULO_DO_CLIENTE = [
  "empresa",
  "primeiros_passos",
  "canais",
  "funis",
  "agentes",
  "followups",
  "equipe",
  "conversoes",
  "plano_e_cobranca",
] as const;

export type ColunaDoRotulo = "preenchido" | "posso_completar" | "preciso_confirmar";
export type QuemFaz = "voce" | "quem_administra" | "time_company";
export type ChaveDoItem = "dados_da_empresa" | "whatsapp" | "agente" | "funil" | "followup" | "ensaio" | "equipe" | "plano";
export type PropostaDoItem = "agente" | "funil" | "followup";

/** Um texto da tela: a frase com `{nome}` e os valores. */
export interface Frase {
  texto: string;
  vars?: Record<string, string>;
}

export interface ItemDoRotulo {
  chave: ChaveDoItem;
  coluna: ColunaDoRotulo;
  titulo: Frase;
  detalhe: Frase;
  /** Só em "preciso confirmar": quem faz. */
  quem?: QuemFaz;
  /** A dependência explícita ("Depende do agente"): enquanto existir, o botão fica desligado. */
  depende_de?: { chave: ChaveDoItem; texto: Frase };
  /** A consequência de não fazer (informativa, não trava o botão). */
  consequencia?: Frase;
  /** Só em "posso completar": a proposta que o assistente prepara. */
  proposta?: PropostaDoItem;
  /** O botão da tela: "Me leva lá", "Abrir Plano e cobrança". */
  ir?: { rotulo: string; href: string };
  /** Uma data que a tela formata no idioma da pessoa (o fim do teste, a entrada com o Facebook). */
  quando?: string | null;
}

export interface ItemQueNaoSeAplica {
  chave: string;
  titulo: Frase;
  porque: Frase;
}

export interface RotuloDoCliente {
  segmento: SegmentoDoOnboarding;
  /** O nome do agente do modelo, para as frases ("a Clara"). */
  agente: string;
  no_passo_a_passo: boolean;
  itens: ItemDoRotulo[];
  nao_se_aplica: ItemQueNaoSeAplica[];
  contas: {
    total: number;
    faltam: number;
    preenchido: number;
    posso_completar: number;
    preciso_confirmar: number;
    nao_se_aplica: number;
  };
  /** As áreas que não deu para medir com o acesso de quem pergunta: os itens delas ficam de fora. */
  nao_medidas: string[];
}

/** O texto montado, para quem não traduz (o MCP, o assistente). */
export function montarFrase(frase: Frase): string {
  let texto = frase.texto;
  for (const [nome, valor] of Object.entries(frase.vars ?? {})) texto = texto.split(`{${nome}}`).join(valor);
  return texto;
}

interface Contexto {
  /** O papel de quem vai ler: o MCP lê como administrador (a régua da Time). */
  papel: Role;
  /** Os follow-ups (id do fluxo) que uma proposta aplicada arma para sair junto com o agente. */
  followupsQueSaemComOAgente?: readonly string[];
}

type Dados = Record<string, unknown> | undefined;

function dadosDe(areas: readonly AreaAvaliada[], chave: string): { medida: boolean; dados: Dados; area?: AreaAvaliada } {
  const area = areas.find((a) => a.area === chave);
  if (!area || area.situacao === "nao_medida") return { medida: false, dados: undefined, area };
  return { medida: true, dados: area.dados, area };
}

const frase = (texto: string, vars?: Record<string, string>): Frase => (vars ? { texto, vars } : { texto });

export function rotuloDoCliente(areas: readonly AreaAvaliada[], ctx: Contexto): RotuloDoCliente {
  const administra = roleAtLeast(ctx.papel, "admin");
  const quemFaz: QuemFaz = administra ? "voce" : "quem_administra";
  const naoMedidas = areas.filter((a) => a.situacao === "nao_medida").map((a) => a.area);

  const pp = dadosDe(areas, "primeiros_passos").dados as
    | {
        no_passo_a_passo?: boolean;
        passos?: Array<{ passo: string; situacao: string }>;
        segmento?: SegmentoDoOnboarding | null;
        ensaio_feito?: boolean;
        numero_oficial?: { esperando_a_time: boolean; entrou_com_facebook_em: string | null } | null;
      }
    | undefined;
  const segmento: SegmentoDoOnboarding = pp?.segmento ?? "outro";
  const modelo = modeloDoSegmento(segmento);
  const persona = modelo.persona;
  const noPassoAPasso = pp?.no_passo_a_passo === true;
  const passo = (id: string) => pp?.passos?.find((p) => p.passo === id)?.situacao ?? "pendente";
  const curto = modelo.curto;

  const itens: ItemDoRotulo[] = [];
  const naoSeAplica: ItemQueNaoSeAplica[] = [];

  // ── 1. os dados da empresa (o passo "Seu negócio") ──
  const empresa = dadosDe(areas, "empresa");
  if (empresa.medida) {
    const e = empresa.dados as { nome?: string; fuso?: string } | undefined;
    const placeholder = (empresa.area?.falta ?? []).some((f) => /nome de instalação nova/.test(f.o_que));
    if (passo("welcome") === "feito" || (!placeholder && !noPassoAPasso)) {
      itens.push({
        chave: "dados_da_empresa",
        coluna: "preenchido",
        titulo: frase("Dados da empresa"),
        detalhe: frase("{nome} · {segmento} · fuso {fuso}", {
          nome: e?.nome ?? "",
          segmento: modelo.rotulo,
          fuso: e?.fuso ?? "",
        }),
      });
    } else {
      itens.push({
        chave: "dados_da_empresa",
        coluna: "preciso_confirmar",
        titulo: frase("Dados da empresa"),
        detalhe: frase("O nome, o que vocês fazem e o fuso. É daqui que saem os modelos."),
        quem: quemFaz,
        ir: { rotulo: "Me leva lá", href: noPassoAPasso ? "/onboarding/welcome" : "/app/settings/tenant" },
      });
    }
  }

  // ── 2. o número de WhatsApp ──
  const canais = dadosDe(areas, "canais");
  if (canais.medida) {
    const numeros = ((canais.dados as { numeros?: Array<{ conectado: boolean }> } | undefined)?.numeros ?? []).filter((n) => n.conectado);
    if (numeros.length > 0) {
      itens.push({
        chave: "whatsapp",
        coluna: "preenchido",
        titulo: frase("Número de WhatsApp"),
        detalhe:
          numeros.length === 1
            ? frase("1 número conectado")
            : frase("{n} números conectados", { n: String(numeros.length) }),
      });
    } else if (pp?.numero_oficial?.esperando_a_time) {
      itens.push({
        chave: "whatsapp",
        coluna: "preciso_confirmar",
        titulo: frase("Ligar o número oficial à empresa"),
        detalhe: frase("Você já entrou com o Facebook. A Time Company liga o número à empresa em até 1 dia útil."),
        quem: "time_company",
        quando: pp.numero_oficial.entrou_com_facebook_em,
      });
    } else {
      itens.push({
        chave: "whatsapp",
        coluna: "preciso_confirmar",
        titulo: frase("Conectar o WhatsApp"),
        detalhe: frase("Pelo celular (QR) ou com o número oficial. Canal é coisa que só você faz."),
        quem: quemFaz,
        consequencia: frase("Sem número, {agente} não tem por onde atender.", { agente: persona }),
        ir: { rotulo: "Me leva lá", href: noPassoAPasso ? "/onboarding/connect-whatsapp" : "/app/connections" },
      });
    }
  }

  // ── 3. o agente ──
  const agentes = dadosDe(areas, "agentes");
  type AgenteLido = { id: string; nome: string; situacao: string; rascunho_pendente: number | null };
  const listaDeAgentes = ((agentes.dados as { agentes?: AgenteLido[] } | undefined)?.agentes ?? []) as AgenteLido[];
  const temAgente = listaDeAgentes.length > 0;
  if (agentes.medida) {
    const noAr = listaDeAgentes.filter((a) => a.situacao === "no ar");
    const comRascunhoNovo = noAr.find((a) => a.rascunho_pendente !== null);
    if (!temAgente) {
      itens.push({
        chave: "agente",
        coluna: "posso_completar",
        titulo: frase("Criar {agente} do modelo de {segmento}", { agente: persona, segmento: curto }),
        detalhe: frase("O assistente prepara o agente do segmento como rascunho. Nada vai ao ar."),
        proposta: "agente",
      });
    } else if (noAr.length > 0 && !comRascunhoNovo) {
      itens.push({
        chave: "agente",
        coluna: "preenchido",
        titulo: frase("Agente no ar"),
        detalhe: frase("{nome}, do modelo de {segmento}", { nome: noAr[0]!.nome, segmento: curto }),
      });
    } else if (comRascunhoNovo) {
      itens.push({
        chave: "agente",
        coluna: "preciso_confirmar",
        titulo: frase("Publicar a versão nova de {nome}", { nome: comRascunhoNovo.nome }),
        detalhe: frase("O rascunho mais novo ainda não está no ar. Publicar é clique seu."),
        quem: quemFaz,
        ir: { rotulo: "Me leva lá", href: `/app/ai/agents/${comRascunhoNovo.id}` },
      });
    } else {
      const rascunho = listaDeAgentes[0]!;
      itens.push({
        chave: "agente",
        coluna: "preciso_confirmar",
        titulo: frase("Publicar {nome}", { nome: rascunho.nome }),
        detalhe: frase("Rascunho não responde ninguém. Publicar é clique seu, de preferência depois do ensaio."),
        quem: quemFaz,
        ir: { rotulo: "Me leva lá", href: noPassoAPasso ? "/onboarding/setup-ai" : `/app/ai/agents/${rascunho.id}` },
      });
    }
  }

  // ── 4. o funil ──
  const funis = dadosDe(areas, "funis");
  if (funis.medida) {
    type FunilLido = { nome: string; etapas: number; de_e_commerce?: boolean; com_ganho_e_perda?: boolean; padrao?: boolean };
    const lista = ((funis.dados as { funis?: FunilLido[] } | undefined)?.funis ?? []) as FunilLido[];
    const proprios = lista.filter((f) => !f.de_e_commerce && f.com_ganho_e_perda !== false);
    const doCliente = proprios.find((f) => f.padrao) ?? proprios[0];
    if (doCliente) {
      itens.push({
        chave: "funil",
        coluna: "preenchido",
        titulo: frase("Funil"),
        detalhe: frase("{nome} · {n} etapas", { nome: doCliente.nome, n: String(doCliente.etapas) }),
      });
    } else {
      itens.push({
        chave: "funil",
        coluna: "posso_completar",
        titulo: frase("Montar o funil \"{nome}\"", { nome: pacoteDoSegmento(segmento).proposta.nome }),
        detalhe: frase("O quadro pronto de {segmento}, com o passo do agente em cada etapa.", { segmento: curto }),
        proposta: "funil",
      });
    }
  }

  // ── 5. o follow-up ──
  const followups = dadosDe(areas, "followups");
  if (followups.medida) {
    type FluxoLido = { id: string; nome: string; situacao: string };
    const fluxos = ((followups.dados as { fluxos?: FluxoLido[] } | undefined)?.fluxos ?? []) as FluxoLido[];
    const publicado = fluxos.find((f) => f.situacao === "publicado");
    const saiJunto = fluxos.find((f) => f.situacao === "rascunho" && (ctx.followupsQueSaemComOAgente ?? []).includes(f.id));
    const rascunho = fluxos.find((f) => f.situacao === "rascunho");
    const nomeDoModelo = modeloPorId(modelo.followup.modelo)?.nome ?? "";
    if (publicado) {
      itens.push({ chave: "followup", coluna: "preenchido", titulo: frase("Follow-up"), detalhe: frase("{nome}", { nome: publicado.nome }) });
    } else if (saiJunto) {
      itens.push({
        chave: "followup",
        coluna: "preenchido",
        titulo: frase("Follow-up"),
        detalhe: frase("{nome} · sai junto com o agente", { nome: saiJunto.nome }),
      });
    } else if (rascunho) {
      itens.push({
        chave: "followup",
        coluna: "preciso_confirmar",
        titulo: frase("Publicar o follow-up {nome}", { nome: rascunho.nome }),
        detalhe: frase("Rascunho não manda mensagem. Publicar é clique seu, depois de ler os textos."),
        quem: quemFaz,
        ir: { rotulo: "Me leva lá", href: "/app/ai/followups" },
      });
    } else {
      itens.push({
        chave: "followup",
        coluna: "posso_completar",
        titulo: frase("Ligar o follow-up do modelo"),
        detalhe: frase("\"{nome}\": retoma quem parou de responder.", { nome: nomeDoModelo }),
        proposta: "followup",
        ...(temAgente ? {} : { depende_de: { chave: "agente" as const, texto: frase("Depende do agente: o follow-up é de um agente.") } }),
      });
    }
  }

  // ── 6. o ensaio (o passo "Ver ele atender") ──
  if (pp) {
    if (pp.ensaio_feito) {
      itens.push({
        chave: "ensaio",
        coluna: "preenchido",
        titulo: frase("Ensaio"),
        detalhe: frase("Você conversou com {agente} antes do primeiro cliente.", { agente: persona }),
      });
    } else {
      itens.push({
        chave: "ensaio",
        coluna: "preciso_confirmar",
        titulo: frase("Ver {agente} atender", { agente: persona }),
        detalhe: frase("Um ensaio: você escreve como cliente e nada sai para ninguém."),
        quem: "voce",
        ir: { rotulo: "Me leva lá", href: noPassoAPasso ? "/onboarding/testar" : "/app/ai/agents" },
        ...(temAgente ? {} : { depende_de: { chave: "agente" as const, texto: frase("Depende do agente.") } }),
      });
    }
  }

  // ── 7. a equipe ──
  const equipe = dadosDe(areas, "equipe");
  if (equipe.medida) {
    const d = equipe.dados as { membros?: unknown[]; convites_pendentes?: unknown[] } | undefined;
    const membros = d?.membros?.length ?? 0;
    const convites = d?.convites_pendentes?.length ?? 0;
    if (membros > 1 || convites > 0) {
      itens.push({
        chave: "equipe",
        coluna: "preenchido",
        titulo: frase("Equipe"),
        detalhe: frase("{membros} na equipe · {convites} convite(s) esperando", { membros: String(membros), convites: String(convites) }),
      });
    } else {
      itens.push({
        chave: "equipe",
        coluna: "preciso_confirmar",
        titulo: frase("Convidar a equipe"),
        detalhe: frase("Quem entra e com qual papel. Convite é coisa que só você faz."),
        quem: quemFaz,
        ir: { rotulo: "Me leva lá", href: noPassoAPasso ? "/onboarding/invite-team" : "/app/team" },
      });
    }
  }

  // ── 8. o plano ──
  const plano = dadosDe(areas, "plano_e_cobranca");
  if (!administra) {
    naoSeAplica.push({ chave: "plano", titulo: frase("Plano e cobrança"), porque: frase("é de quem administra a empresa") });
  } else if (plano.medida) {
    const p = plano.dados as { aplica?: boolean; motivo?: string; assinou?: boolean; plano?: string | null; teste_ate?: string | null; estado?: string } | undefined;
    if (!p?.aplica) {
      naoSeAplica.push({
        chave: "plano",
        titulo: frase("Plano e cobrança"),
        porque:
          p?.motivo === "cobranca_desligada"
            ? frase("a cobrança está desligada nesta instalação")
            : p?.motivo === "demonstracao"
              ? frase("empresa de demonstração")
              : frase("a empresa é isenta"),
      });
    } else if (p.assinou && p.estado !== "em_atraso") {
      itens.push({
        chave: "plano",
        coluna: "preenchido",
        titulo: frase("Plano assinado"),
        detalhe: p.plano ? frase("{plano}", { plano: p.plano }) : frase("Assinatura em dia"),
      });
    } else {
      itens.push({
        chave: "plano",
        coluna: "preciso_confirmar",
        titulo: p.assinou ? frase("Regularizar o pagamento") : frase("Assinar o plano"),
        detalhe: frase("Pagamento é coisa que só você faz."),
        quem: "voce",
        quando: p.assinou ? null : (p.teste_ate ?? null),
        ir: { rotulo: "Abrir Plano e cobrança", href: "/app/settings/billing" },
      });
    }
  }

  // ── o que não se aplica agora ──
  const conversoes = dadosDe(areas, "conversoes");
  const ligadas = (conversoes.dados as { conexoes_ligadas?: string[] } | undefined)?.conexoes_ligadas ?? [];
  if (!conversoes.medida || ligadas.length === 0) {
    naoSeAplica.push({
      chave: "conversoes",
      titulo: frase("Conversões da Meta e do Google"),
      porque: frase("não há conta de anúncios ligada"),
    });
  }
  naoSeAplica.push({ chave: "base_importada", titulo: frase("Base importada"), porque: frase("começar vazio não é pendência") });

  const conta = (c: ColunaDoRotulo) => itens.filter((i) => i.coluna === c).length;
  return {
    segmento,
    agente: persona,
    no_passo_a_passo: noPassoAPasso,
    itens,
    nao_se_aplica: naoSeAplica,
    contas: {
      total: itens.length,
      faltam: itens.filter((i) => i.coluna !== "preenchido").length,
      preenchido: conta("preenchido"),
      posso_completar: conta("posso_completar"),
      preciso_confirmar: conta("preciso_confirmar"),
      nao_se_aplica: naoSeAplica.length,
    },
    nao_medidas: naoMedidas,
  };
}

/** O rótulo em texto corrido, para o MCP e para o assistente (sem tradução). */
export function rotuloEmTexto(r: RotuloDoCliente) {
  return {
    faltam: r.contas.faltam,
    total: r.contas.total,
    segmento: r.segmento,
    itens: r.itens.map((i) => ({
      item: i.chave,
      coluna: i.coluna,
      titulo: montarFrase(i.titulo),
      detalhe: montarFrase(i.detalhe),
      ...(i.quem ? { quem_faz: i.quem === "time_company" ? "Time Company" : i.quem === "voce" ? "quem administra a empresa" : "quem administra a empresa" } : {}),
      ...(i.depende_de ? { depende_de: montarFrase(i.depende_de.texto) } : {}),
      ...(i.consequencia ? { consequencia: montarFrase(i.consequencia) } : {}),
      ...(i.proposta ? { o_assistente_prepara: i.proposta } : {}),
      ...(i.ir ? { tela: i.ir.href } : {}),
      ...(i.quando ? { quando: i.quando } : {}),
    })),
    nao_se_aplica: r.nao_se_aplica.map((n) => `${montarFrase(n.titulo)}: ${montarFrase(n.porque)}`),
    ...(r.nao_medidas.length > 0 ? { nao_medidas: r.nao_medidas } : {}),
  };
}
