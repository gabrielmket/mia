/**
 * FORK MIA (.89) — MONTAR E MANDAR um e-mail de campanha (ou de teste).
 *
 * Junta o que a campanha diz (blocos, assunto, remetente), o que a empresa
 * configurou (rodapé, "responder para", domínio) e o que é da pessoa (nome,
 * empresa, responsável, campos), e entrega à Amazon pelo transporte próprio do
 * disparo (`lib/email/ses.ts`).
 *
 * ── A trava da demonstração, ANTES da rede ───────────────────────────────────
 *
 * O roteador do e-mail do sistema pergunta à trava da demonstração antes de
 * cada envio (9010). Este caminho não passa pelo roteador, então pergunta aqui,
 * pelo mesmo `travaDaDemonstracao`, e falha FECHADO: sem confirmar que a empresa
 * é de verdade, nada sai — nem o teste. O banco segura de novo (9064).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { marcaDaSaida } from "@/lib/branding/saida";
import { travaDaDemonstracao } from "@/lib/demonstracao/trava";
import { enviarPelaAmazon, type DependenciasDaAmazon, type ErroDaAmazon } from "@/lib/email/ses";
import { env } from "@/lib/env";
import { lerMembros } from "@/lib/implantacao/equipe";

import {
  lerConfiguracao,
  lerDominio,
  lerEmpresa,
  lerRemetentes,
  rodapeDoEnvio,
  type ConfiguracaoDoEmail,
  type DominioDoEmail,
  type EmpresaDoEmail,
  type RemetenteDoEmail,
} from "./banco";
import { montarEmail, type BlocoDoEmail, type EmailMontado } from "./blocos";
import { montarMime } from "./mime";
import { linkDoClique, linksDoDestinatario } from "./token";
import type { ValoresDoContato } from "./variaveis";

export interface ContextoDeEnvio {
  empresa: EmpresaDoEmail;
  config: ConfiguracaoDoEmail;
  dominio: DominioDoEmail | null;
  remetentes: RemetenteDoEmail[];
  cor: { fundo: string; frente: string };
  origem: string;
  /** Nome de cada pessoa da equipe, para `{{responsavel}}`. */
  nomesDaEquipe: Map<string, string>;
}

export async function contextoDeEnvio(
  admin: SupabaseClient,
  orgId: string,
  opcoes: { comEquipe?: boolean } = {},
): Promise<ContextoDeEnvio> {
  const empresa = await lerEmpresa(admin, orgId);
  const [config, dominio, remetentes, marca, membros] = await Promise.all([
    lerConfiguracao(admin, empresa),
    lerDominio(admin, orgId),
    lerRemetentes(admin, orgId),
    marcaDaSaida(orgId),
    opcoes.comEquipe === false ? Promise.resolve([]) : lerMembros(admin, orgId).catch(() => []),
  ]);
  const nomesDaEquipe = new Map<string, string>();
  for (const m of membros) {
    const nome = (m.nome ?? "").trim() || (m.email ? m.email.split("@")[0]! : "");
    if (nome) nomesDaEquipe.set(m.user_id, nome);
  }
  return {
    empresa,
    config,
    dominio,
    remetentes,
    cor: { fundo: marca.accent, frente: marca.accentFg },
    origem: env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, ""),
    nomesDaEquipe,
  };
}

export interface CampanhaParaEnvio {
  id: string;
  nome: string;
  remetente_id: string | null;
  assunto: string;
  pre_cabecalho: string;
  blocos: BlocoDoEmail[];
  reservas: Record<string, string>;
  base_legal: "consent" | "legitimate_interest";
}

export function remetenteDaCampanha(
  ctx: ContextoDeEnvio,
  campanha: Pick<CampanhaParaEnvio, "remetente_id">,
): RemetenteDoEmail | null {
  return (
    ctx.remetentes.find((r) => r.id === campanha.remetente_id) ??
    ctx.remetentes.find((r) => r.padrao) ??
    ctx.remetentes[0] ??
    null
  );
}

export interface MensagemPronta {
  de: string;
  deNome: string;
  para: string;
  montado: EmailMontado;
  mime: string;
}

/**
 * O e-mail de UMA pessoa. `destinatarioId` = a linha da campanha (os links
 * medem); ausente = o TESTE (links diretos, descadastro inerte, sem pixel).
 */
export function montarParaUmaPessoa(
  ctx: ContextoDeEnvio,
  campanha: CampanhaParaEnvio,
  pessoa: {
    para: string;
    destinatarioId: string | null;
    valores: ValoresDoContato;
    medirAbertura: boolean;
    /** id do link congelado de cada botão, pela ordem (envio de verdade). */
    linksPorOrdem?: ReadonlyMap<number, string>;
  },
  agora: Date,
): MensagemPronta | { erro: "sem_dominio" | "sem_remetente" } {
  if (!ctx.dominio) return { erro: "sem_dominio" };
  const remetente = remetenteDaCampanha(ctx, campanha);
  if (!remetente) return { erro: "sem_remetente" };
  const teste = !pessoa.destinatarioId;
  const links = linksDoDestinatario(ctx.origem, {
    o: ctx.empresa.id,
    r: pessoa.destinatarioId ?? campanha.id,
    teste,
  });
  const montado = montarEmail({
    campanha: {
      assunto: campanha.assunto,
      preCabecalho: campanha.pre_cabecalho,
      blocos: campanha.blocos,
      reservas: campanha.reservas,
    },
    valores: pessoa.valores,
    nomeDaEmpresa: ctx.empresa.nome,
    cor: ctx.cor,
    rodape: rodapeDoEnvio(ctx.config, links.privacidadePadrao),
    links: {
      descadastro: links.descadastroPelaPagina,
      preferencias: links.preferencias,
      // Interesse legítimo, ou sem o aviso de medição: sem pixel.
      pixel:
        !teste && pessoa.medirAbertura && campanha.base_legal === "consent" ? links.abertura : null,
      clique:
        !teste && pessoa.linksPorOrdem
          ? (ordem, destino) => {
              const linkId = pessoa.linksPorOrdem!.get(ordem);
              return linkId
                ? linkDoClique(ctx.origem, {
                    o: ctx.empresa.id,
                    r: pessoa.destinatarioId!,
                    l: linkId,
                  })
                : destino;
            }
          : undefined,
    },
    quando: { agora, fuso: ctx.empresa.fuso },
    teste,
  });
  const de = `${remetente.local}@${ctx.dominio.dominio}`;
  const mime = montarMime({
    de: { nome: remetente.nome, endereco: de },
    para: pessoa.para,
    responderPara: ctx.config.responderPara,
    assunto: montado.assunto,
    html: montado.html,
    texto: montado.texto,
    descadastro: links.descadastroDeUmClique,
    feedbackId: `${campanha.id.slice(0, 8)}:${ctx.empresa.id.slice(0, 8)}:mia`,
  });
  return { de, deNome: remetente.nome, para: pessoa.para, montado, mime };
}

export type ResultadoDoEnvio =
  | { ok: true; messageId: string }
  | { ok: false; erro: ErroDaAmazon | "organizacao_de_demonstracao"; detalhe: string };

/** Manda pela Amazon, com a trava da demonstração antes. */
export async function mandar(
  admin: SupabaseClient,
  orgId: string,
  mensagem: MensagemPronta,
  etiquetas: Record<string, string>,
  deps: DependenciasDaAmazon = {},
): Promise<ResultadoDoEnvio> {
  const trava = await travaDaDemonstracao(admin, orgId);
  if (trava.travado) {
    return { ok: false, erro: "organizacao_de_demonstracao", detalhe: trava.motivo };
  }
  const r = await enviarPelaAmazon(
    { de: mensagem.de, para: mensagem.para, mensagemMime: mensagem.mime, etiquetas },
    deps,
  );
  return r.ok
    ? { ok: true, messageId: r.dados.messageId }
    : { ok: false, erro: r.erro, detalhe: r.detalhe };
}
