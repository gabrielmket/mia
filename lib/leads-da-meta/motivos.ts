/**
 * FORK MIA — o vocabulário do histórico de leituras dos leads da Meta.
 *
 * O banco guarda o CÓDIGO (`mia_leads_da_meta_leituras.motivo`); a tela traduz
 * para a frase que diz o que fazer (`MENSAGEM_DO_MOTIVO` no componente). O
 * status tem CHECK na migration 9003 e a lista aqui é a mesma.
 */
import type { FalhaDeLeitura } from "@/lib/plataformas-de-anuncio/types";
import type { MotivoSemLeitura } from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";

export const STATUS_DA_LEITURA = ["sucesso", "sem_novos", "erro"] as const;
export type StatusDaLeitura = (typeof STATUS_DA_LEITURA)[number];

export type MotivoDaLeitura =
  // da credencial da empresa
  | MotivoSemLeitura
  // da Meta, como o eixo de anúncio classifica
  | FalhaDeLeitura
  // desta rotina
  // FORK MIA (.61): a Página não é desta empresa na PLATAFORMA (9004). Também é
  // o motivo que o gatilho do banco grava ao desligar o formulário quando a
  // Página muda de dono. Não confundir com a de baixo, que é do lado da Meta.
  | "pagina_nao_e_da_empresa"
  // FORK MIA (.64): a empresa desmarcou a Página que tinha assumido pela conta
  // própria (9008). Gravado por `fn_mia_soltar_pagina_da_meta` ao desligar.
  | "pagina_solta"
  // a Página é da empresa, mas nenhum token a alcança (atribuição no Gerenciador)
  | "pagina_nao_atribuida"
  | "sem_token_da_pagina"
  | "sem_funil"
  | "volume_acima_do_limite"
  | "erro_ao_gravar"
  // ressalvas de uma leitura que deu certo
  | "sem_origem_do_anuncio"
  | "recuperacao_cortada";

/** Ressalva não é erro: a leitura deu certo, com um senão que a tela mostra. */
export function motivoEhRessalva(motivo: string | null): boolean {
  return motivo === "sem_origem_do_anuncio" || motivo === "recuperacao_cortada";
}
