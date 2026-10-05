/**
 * FORK MIA · A BANCADA — a "Empresa Modelo · Demonstração", como sempre foi.
 *
 * Dez funis de segmentos misturados, os modelos de follow-up de TODOS os
 * segmentos e as obrigações de Serviços B2B. É ótima para testar e confusa
 * para mostrar a um cliente: para isso existem as demonstrações por segmento
 * (os outros arquivos desta pasta).
 *
 * Os dados moram em `../dados.ts`, onde sempre moraram, e os ids NÃO têm
 * prefixo (`prefixoDosIds: ""`): são exatamente os de antes, para a empresa que
 * já está em produção ser renovada, e não duplicada.
 */
import { MODELOS_DE_FOLLOWUP, type NichoDeModelo } from "@/lib/followup/modelos";
import { MODULO_DOS_LEADS_DA_META } from "@/lib/leads-da-meta/modulo";

import {
  AGENTE_DE_IA,
  COMPROMISSOS,
  CONTATOS,
  CONVERSAS,
  EMPRESAS,
  EQUIPE,
  FUNIL_DAS_OBRIGACOES,
  FUNIS,
  INSCRICOES,
  NOME_DA_EMPRESA,
  OBRIGACOES,
  RAZAO_SOCIAL,
  SESSAO_DO_CANAL,
  SLUG_DA_EMPRESA,
  TAREFAS,
  TELEFONE_DO_CANAL,
} from "../dados";
import type { ChaveDoFunil, SementeDeDemonstracao } from "../tipos";

/** O funil de cada segmento de follow-up dentro da bancada. */
const FUNIL_DO_NICHO: Record<NichoDeModelo, ChaveDoFunil> = {
  geral: "generico",
  clinica: "clinica",
  imobiliario: "imobiliaria",
  automotivo: "automotivo",
  academia: "academia",
  servicos_b2b: "servicos",
  // A indústria vende para empresa: na bancada, os modelos dela ficam em
  // rascunho no funil de serviços B2B (a demonstração própria tem o funil dela).
  industria_b2b: "servicos",
};

export const BANCADA: SementeDeDemonstracao = {
  segmento: "bancada",
  rotulo: "Bancada de teste (todos os segmentos)",
  oQueMostra:
    "A Empresa Modelo: dez funis de segmentos misturados, os follow-ups de todos os segmentos e as obrigações de serviços B2B. Serve para testar a plataforma inteira, não para mostrar a um cliente.",
  nome: NOME_DA_EMPRESA,
  razaoSocial: RAZAO_SOCIAL,
  slug: SLUG_DA_EMPRESA,
  prefixoDosIds: "",
  sessaoDoCanal: SESSAO_DO_CANAL,
  telefoneDoCanal: TELEFONE_DO_CANAL,
  modoDeVenda: "b2b",
  formularioDaMeta: "Formulário · Empresa Modelo (demonstração)",
  enderecoFicticio: "Unidade da demonstração (endereço fictício)",
  equipe: [...EQUIPE],
  gestor: "helena",
  agente: { chave: "sofia", ...AGENTE_DE_IA },
  modulos: ["disparador", MODULO_DOS_LEADS_DA_META],
  empresas: [...EMPRESAS],
  contatos: [...CONTATOS],
  funis: [...FUNIS],
  funilPadrao: "generico",
  conversas: [...CONVERSAS],
  tiposDeAgenda: [
    { slug: "visita", nome: "Visita ao imóvel", categoria: "visita", duracao: 60 },
    { slug: "test-drive", nome: "Test drive", categoria: "demonstracao", duracao: 45 },
    { slug: "aula-experimental", nome: "Aula experimental", categoria: "outro", duracao: 60 },
  ],
  compromissos: [...COMPROMISSOS],
  tarefas: [...TAREFAS],
  // Todos os modelos do catálogo, cada um no funil do segmento dele. A etapa do
  // gatilho é a de proposta para as jornadas de decisão e a de qualificado para
  // as outras (as de silêncio e de falta ignoram a etapa).
  followups: MODELOS_DE_FOLLOWUP.map((m) => ({
    modelo: m.id,
    funil: FUNIL_DO_NICHO[m.nicho],
    etapa: /proposta|negociacao|matricula|decisao/.test(m.id) ? "negotiating" : "qualified",
  })),
  inscricoes: [...INSCRICOES],
  obrigacoes: { funil: FUNIL_DAS_OBRIGACOES, segmento: "servicos_b2b", itens: [...OBRIGACOES] },
  produtos: [],
};
