/**
 * GET /api/v1/agenda/microsoft/callback: a volta do consentimento da Microsoft.
 *
 * FORK MIA (docs/fork/agenda-microsoft.md). A ordem dos passos é a do callback
 * do Google do upstream, e cada um tem o motivo escrito lá:
 *
 *  1. `error` antes de tudo (quem desistiu não é falha); aqui ele também separa
 *     o erro raro "a empresa exige que o TI aprove o app";
 *  2. `state` assinado; 3. vínculo do navegador ANTES de queimar o nonce;
 *  4. queima do nonce ANTES de trocar o código (o código é de uso único);
 *  5. escopos DEPOIS da troca e ANTES de gravar; 6. cifra ANTES de gravar.
 *
 * Depois de gravar, o catálogo das agendas é lido na hora (sem ele nada é lido
 * e nada ocupa) e as notificações são ligadas; as duas coisas também são
 * refeitas pelas rotinas, então uma falha aqui não derruba a conexão.
 */

import { NextResponse, type NextRequest } from "next/server";

import { verificarEstado } from "@/lib/agenda/google/estado";
import { NOME_DO_VINCULO, vinculoConfere } from "@/lib/agenda/google/vinculo";
import { atualizarCatalogoMicrosoft } from "@/lib/agenda/microsoft/calendar-executor";
import { configuracaoDaMicrosoft, enderecoDeRetornoMicrosoft, origemPublicaDoPedido } from "@/lib/agenda/microsoft/config";
import { garantirAssinaturas } from "@/lib/agenda/microsoft/notificacoes";
import {
  codigoDoEntra,
  empresaPrecisaAprovar,
  escoposFaltandoMicrosoft,
  lerIdToken,
  tipoDeConta,
  verificadorPkce,
} from "@/lib/agenda/microsoft/oauth";
import { voltarParaAAgenda } from "@/lib/agenda/microsoft/ponte";
import { trocarCodigoPorTokenMicrosoft } from "@/lib/agenda/microsoft/token";
import { graphTransport } from "@/lib/agenda/microsoft/transport";
import { audit } from "@/lib/audit";
import { ehRecusaDaDemonstracao } from "@/lib/demonstracao/trava";
import { env } from "@/lib/env";
import { supportCallbackWriteAllowed } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const origem = origemPublicaDoPedido(req.headers);
  const voltar = (parametro: string) => voltarParaAAgenda(origem, parametro);

  const recusa = url.searchParams.get("error");
  const descricao = url.searchParams.get("error_description");
  const stateBruto = url.searchParams.get("state");

  // A volta do consentimento do ADMINISTRADOR (o link para o TI). Não conecta
  // ninguém: só diz que a empresa aprovou, e a pessoa conecta em seguida.
  if (stateBruto === "aprovacao_do_ti") {
    if (url.searchParams.get("admin_consent")?.toLowerCase() === "true") return voltar("ms_ok=ti_aprovou");
    return voltar("ms_erro=ti_nao_aprovou");
  }

  // 1. Desistência, ou a empresa que exige aprovação do TI (o erro raro).
  if (recusa) {
    if (empresaPrecisaAprovar(recusa, descricao)) return voltar("ms_erro=precisa_aprovacao");
    if (recusa === "access_denied") return voltar("ms_erro=conexao_cancelada");
    logger.warn("[agenda.microsoft.callback] a Microsoft recusou na volta", {
      erro: recusa,
      codigo: codigoDoEntra(descricao),
    });
    return voltar("ms_erro=troca_de_codigo_falhou");
  }

  // 2. De quem é o retorno.
  let estado: ReturnType<typeof verificarEstado> = null;
  try {
    estado = verificarEstado(stateBruto, { segredo: env.INTERNAL_SECRET, agora: new Date() });
  } catch {
    return voltar("ms_erro=retorno_nao_verificavel");
  }
  if (!estado) {
    await audit({ action: "agenda.microsoft.conexao_falhou", metadata: { reason: "state_invalido" } });
    return voltar("ms_erro=retorno_nao_verificavel");
  }
  const { organizationId, userId } = estado;

  // 3. Quem voltou é quem saiu (o vínculo), antes de queimar o nonce.
  if (!vinculoConfere(req.cookies.get(NOME_DO_VINCULO)?.value, estado.nonce, env.INTERNAL_SECRET)) {
    await audit({
      action: "agenda.microsoft.conexao_falhou",
      organizationId,
      metadata: { reason: "vinculo_ausente_ou_nao_confere", user_id: userId },
    });
    return voltar("ms_erro=retorno_nao_verificavel");
  }

  const code = url.searchParams.get("code");
  if (!code) return voltar("ms_erro=retorno_incompleto");

  const app = await configuracaoDaMicrosoft();
  if (!app) return voltar("ms_erro=nao_configurado");

  // 4. Queima do nonce, antes da troca.
  if (!(await supportCallbackWriteAllowed(organizationId, userId, estado.authSessionId))) {
    return voltar("ms_erro=retorno_nao_verificavel");
  }
  const admin = createAdminClient();
  const { error: erroDoNonce } = await admin.from("calendar_oauth_nonces").insert({
    nonce: estado.nonce,
    organization_id: organizationId,
    user_id: userId,
    expira_em: new Date(estado.expiraEmMs).toISOString(),
  });
  if (erroDoNonce) {
    await audit({
      action: "agenda.microsoft.conexao_falhou",
      organizationId,
      metadata: { reason: erroDoNonce.code === "23505" ? "state_reutilizado" : "nonce_indisponivel", user_id: userId },
    });
    return voltar("ms_erro=retorno_nao_verificavel");
  }

  // 5. A troca do código, com o MESMO endereço da ida e o verificador do PKCE.
  const leitura = await trocarCodigoPorTokenMicrosoft(app, {
    code,
    redirectUri: enderecoDeRetornoMicrosoft(origem),
    verificador: verificadorPkce(estado.nonce, env.INTERNAL_SECRET),
    agora: new Date(),
  });
  if (!leitura.ok) {
    await audit({
      action: "agenda.microsoft.conexao_falhou",
      organizationId,
      metadata: { reason: leitura.motivo, codigo: leitura.codigoDoEntra ?? null, user_id: userId },
    });
    if (empresaPrecisaAprovar(leitura.erro, leitura.codigoDoEntra)) return voltar("ms_erro=precisa_aprovacao");
    return voltar("ms_erro=troca_de_codigo_falhou");
  }
  const token = leitura.token;

  const faltando = escoposFaltandoMicrosoft(token.scope);
  if (faltando.length > 0) {
    await audit({
      action: "agenda.microsoft.conexao_falhou",
      organizationId,
      metadata: { reason: "scope_missing", faltando, user_id: userId },
    });
    return voltar("ms_erro=permissao_incompleta");
  }

  // De quem é a conta. A chave é o id estável da Microsoft; o e-mail pode mudar.
  let conta: { id: string; email: string | null };
  try {
    conta = await graphTransport(token.access_token).me();
  } catch {
    await audit({
      action: "agenda.microsoft.conexao_falhou",
      organizationId,
      metadata: { reason: "conta_indisponivel", user_id: userId },
    });
    return voltar("ms_erro=conta_indisponivel");
  }
  const identidade = lerIdToken(leitura.idToken);
  const email = conta.email ?? identidade.emailPreferido;
  if (!email) return voltar("ms_erro=conta_indisponivel");

  // 6. Sem `refresh_token` a conexão nasce morta (vive 1 h e para calada).
  if (!token.refresh_token) {
    await audit({
      action: "agenda.microsoft.conexao_falhou",
      organizationId,
      metadata: { reason: "sem_token_de_renovacao", user_id: userId },
    });
    return voltar("ms_erro=sem_token_de_renovacao");
  }
  const accessCifrado = await encryptWebhookSecret(admin, token.access_token);
  const refreshCifrado = await encryptWebhookSecret(admin, token.refresh_token);
  if (!accessCifrado || !refreshCifrado) {
    await audit({
      action: "agenda.microsoft.conexao_falhou",
      organizationId,
      metadata: { reason: "cifra_indisponivel", user_id: userId },
    });
    return voltar("ms_erro=cifra_indisponivel");
  }

  // 7. Grava. Org e pessoa vêm do `state` ASSINADO, nunca da query.
  const { data: gravada, error: erroAoGravar } = await admin
    .from("mia_agenda_microsoft_conexoes")
    .upsert(
      {
        organization_id: organizationId,
        user_id: userId,
        microsoft_user_id: conta.id,
        conta_email: email,
        tipo_de_conta: tipoDeConta(identidade.tenantId),
        tenant_id: identidade.tenantId,
        access_token_cifrado: accessCifrado,
        refresh_token_cifrado: refreshCifrado,
        token_expira_em: token.expira_em,
        escopos: token.scope,
        status: "healthy",
        ultimo_erro: null,
        // Reconectar depois de desconectar volta ao começo: o primeiro catálogo
        // escolhe a agenda padrão como fonte (e destino, se não houver outro),
        // em vez de nascer tudo desmarcado e nada ocupar.
        revisao_da_escolha: 0,
      },
      { onConflict: "organization_id,user_id,microsoft_user_id" },
    )
    .select("id")
    .single();
  // A empresa de demonstração não conecta agenda de fora: quem recusa é o banco
  // (migration 9016), e a tela diz por quê em vez de "não consegui salvar".
  if (ehRecusaDaDemonstracao(erroAoGravar)) {
    await audit({
      action: "agenda.microsoft.conexao_falhou",
      organizationId,
      metadata: { reason: "empresa_de_demonstracao", user_id: userId },
    });
    return voltar("ms_erro=empresa_de_demonstracao");
  }
  if (erroAoGravar || !gravada) {
    await audit({
      action: "agenda.microsoft.conexao_falhou",
      organizationId,
      metadata: { reason: "upsert_falhou", user_id: userId },
    });
    return voltar("ms_erro=nao_consegui_guardar");
  }

  // 8. O catálogo e o tempo real. Falha aqui não desfaz a conexão: as rotinas refazem.
  try {
    await atualizarCatalogoMicrosoft(admin, organizationId, gravada.id);
    await garantirAssinaturas(admin, organizationId, gravada.id, token.access_token);
  } catch (e) {
    await audit({
      action: "agenda.microsoft.conexao_falhou",
      organizationId,
      metadata: {
        reason: "catalogo_nao_lido",
        detalhe: e instanceof Error ? e.message.slice(0, 120) : "falha",
        user_id: userId,
      },
    });
  }

  await audit({
    actorUserId: userId,
    actorAuthSessionId: estado.authSessionId,
    action: "agenda.microsoft.conexao_concluida",
    organizationId,
    metadata: { user_id: userId, conta: email, tipo: tipoDeConta(identidade.tenantId) },
  });
  return voltar("ms_ok=agenda_conectada");
}
