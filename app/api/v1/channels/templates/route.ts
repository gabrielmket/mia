import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/channels/templates — o espelho local + o CONTRATO derivado de cada um.
 * POST /api/v1/channels/templates — força um sync com a Graph API.
 * PATCH /api/v1/channels/templates — salva (ou esquece) o link da mídia de um modelo.
 *
 * O contrato vai derivado no payload, e não guardado no banco, de propósito: guardar
 * o derivado criaria a segunda fonte da verdade que esta fase inteira existe para
 * eliminar. A tela e o montador de envio chamam a MESMA `deriveTemplateContract`.
 *
 * Nenhum campo aqui é "quantidade de parâmetros". O número é consequência dos slots;
 * se algum dia aparecer um campo editável com esse nome, o desenho vazou.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { metaSessionForOrg } from "@/lib/channels/meta/session";
import { normalizeRejectedReason } from "@/lib/channels/meta/webhook";
import { deriveTemplateContract, describeAddress } from "@/lib/channels/meta/template-contract";
import { slotKey } from "@/lib/channels/meta/build-components";
// A credencial sai daqui e não de `resolveMetaCreds` direto: `credenciaisDaOrg`
// é a MESMA porta (ela chama `resolveMetaCreds` por dentro, com o client de
// service role) e já resolve a WABA da sessão com o ambiente como reserva. Ver
// o POST abaixo para os dois desfechos que continuam separados.
import { credenciaisDaOrg } from "@/lib/channels/meta/credenciais-da-org";
import { syncTemplates } from "@/lib/channels/meta/template-sync";
import { mesclarValoresSalvos } from "@/lib/channels/meta/valores-salvos";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Um template pronto para a tela: o que a Meta diz + o contrato derivado. */
export interface TemplateView {
  name: string;
  language: string;
  status: string;
  category: string | null;
  rejectedReason: string | null;
  qualityScore: string | null;
  parameterFormat: string;
  contractHash: string;
  syncedAt: string;
  slots: Array<{
    key: string;
    expects: string;
    onde: string;
    /**
     * A chave de `template_values` para ESTE slot, montada por `slotKey` — a
     * mesma função que o montador do payload de envio usa.
     *
     * A `key` sozinha não endereça: um carrossel de dois cards tem dois slots
     * com a mesma `key`, e um cabeçalho de mídia colide com o `{{1}}` do corpo.
     * A tela teria de remontar o prefixo a partir de `onde`, que é rótulo
     * humano ("cabeçalho", "botão 1 (url)") e não sobrevive a isso. Montar a
     * chave de dois jeitos é o mismatch voltando pela porta dos fundos.
     */
    valueKey: string;
  }>;
  /**
   * Texto de cada componente que carrega parâmetro, INTEIRO e uma vez só.
   * Antes a tela mostrava o corpo repetido a cada slot, cada linha destacando o
   * seu e deixando o vizinho cru — correto e ilegível. A UI marca os `{{n}}`.
   */
  previews: Array<{ onde: string; text: string }>;
  /** A definição crua — de onde sai o texto que vai no corpo do envio. */
  components: unknown[];
  /**
   * Links de mídia que o operador salvou para este modelo, na chave de
   * `template_values`. O painel da janela fechada pré-preenche com eles.
   */
  savedValues: Record<string, string>;
}

/** Textos com placeholder, achatados (inclui os de dentro de card de carrossel). */
function textPreviews(components: unknown): Array<{ onde: string; text: string }> {
  const out: Array<{ onde: string; text: string }> = [];
  const visita = (lista: unknown, prefixo: string) => {
    if (!Array.isArray(lista)) return;
    for (const c of lista as Array<Record<string, unknown>>) {
      const tipo = String(c.type ?? "").toUpperCase();
      if (Array.isArray(c.cards)) {
        (c.cards as Array<Record<string, unknown>>).forEach((card, i) =>
          visita(card.components, `card ${i + 1} › `),
        );
        continue;
      }
      const texto = typeof c.text === "string" ? c.text : "";
      if (!texto.includes("{{")) continue;
      out.push({ onde: `${prefixo}${tipo === "HEADER" ? "cabeçalho" : "corpo"}`, text: texto });
    }
  };
  visita(components, "");
  return out;
}

type OrgGate =
  | { autorizado: true; orgId: string }
  | { autorizado: false; resposta: NextResponse };

async function orgOrFail(requestId: string): Promise<OrgGate> {
  const authz = await requireRole("admin", { requestId, resource: "channels_templates" });
  if (!authz.ok) return { autorizado: false, resposta: authz.response };
  return { autorizado: true, orgId: authz.org.orgId };
}

export async function GET(): Promise<NextResponse> {
  const requestId = randomUUID();
  const r = await orgOrFail(requestId);
  if (!r.autorizado) return r.resposta;

  const sessao = await metaSessionForOrg(r.orgId);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("meta_templates")
    .select(
      // `id` é NOSSO (a tela edita e exclui por ele) e `saved_values` é o link
      // de mídia que o painel da janela fechada pré-preenche. Os dois campos
      // são lidos logo abaixo: tirar qualquer um devolve `undefined` calado —
      // a tela perde o botão de editar, ou o disparo sai sem a imagem.
      "id, name, language, status, category, rejected_reason, quality_score, parameter_format, contract_hash, components, synced_at, saved_values",
    )
    .eq("organization_id", r.orgId)
    .order("status")
    .order("name");

  if (error) return fail("internal_error", error.message, 500, { requestId });

  const templates: TemplateView[] = (data ?? []).map((row) => {
    const contrato = deriveTemplateContract({
      name: row.name,
      language: row.language,
      parameter_format: row.parameter_format,
      components: row.components as never,
    });
    return {
      // O id da NOSSA linha: é por ele que a tela edita e exclui. O id da META
      // fica no servidor — a tela não precisa dele, e expô-lo só aumentaria a
      // superfície de quem pode mandar um identificador de fora.
      id: row.id,
      name: row.name,
      language: row.language,
      status: row.status,
      category: row.category,
      // Normaliza na LEITURA também: o "NONE" da Meta pode ter sido gravado por
      // uma versão anterior ao conserto, e um clone atualizado ainda o carrega.
      rejectedReason: normalizeRejectedReason(row.rejected_reason),
      qualityScore: row.quality_score,
      parameterFormat: contrato.parameterFormat,
      contractHash: row.contract_hash,
      syncedAt: row.synced_at,
      slots: contrato.slots.map((s) => ({
        key: s.key,
        /**
         * A chave QUALIFICADA — `1` no corpo, `header:1` no cabeçalho.
         *
         * A crua não distingue os dois: um cabeçalho de mídia nasce com
         * `key: "1"`, igual à primeira variável do corpo. Quem monta a campanha
         * precisa da qualificada por dois motivos: para saber QUAL slot é o
         * nome do contato (só o do corpo) e para chavear o valor do jeito que
         * `buildComponents` vai procurar. Sem ela, a tela pulava o cabeçalho de
         * imagem achando que era a variável do nome — e o disparo saía sem a
         * imagem.
         */
        chave: slotKey(s.address, s.key),
        expects: s.expects,
        onde: describeAddress(s.address),
        // `valueKey` é o MESMO valor de `chave`, com o nome que a outra tela
        // já lê. São duas telas e dois nomes: `components/broadcast/
        // FormularioDoOficial.tsx` procura `chave`, `components/inbox/
        // JanelaFechadaAviso.tsx` procura `valueKey`. Servir um só quebraria
        // uma delas em silêncio — o campo fica `undefined`, o valor nunca é
        // preenchido e o disparo sai sem a imagem. Renomear é trabalho de uma
        // tela por vez; enquanto não acontece, os dois saem daqui.
        valueKey: slotKey(s.address, s.key),
      })),
      previews: textPreviews(row.components),
      // A DEFINIÇÃO crua, como a rota do canal intermediado já devolve.
      //
      // `previews` não serve para isto: ele filtra por `{{` (só interessa
      // mostrar o que tem variável), então um modelo SEM variável sai com a
      // lista vazia — e são exatamente esses que o operador consegue disparar
      // sem preencher nada. O seletor da janela fechada monta o corpo da
      // mensagem a partir daqui; sem o campo, ele caía no NOME TÉCNICO do
      // modelo e era isso que o cliente recebia.
      components: (row.components as unknown[]) ?? [],
      // Filtrado pelo contrato de HOJE: link salvo para um cabeçalho que deixou
      // de ser mídia não pode pré-preencher nada.
      savedValues: (() => {
        const r = mesclarValoresSalvos(contrato, (row.saved_values ?? {}) as Record<string, unknown>, {});
        return r.ok ? r.valores : {};
      })(),
    };
  });

  return ok({
    // `null` aqui não é "erro": é o estado de quem não tem canal oficial ATIVO —
    // nunca conectou, ou conectou e excluiu —, e a tela precisa distingui-lo de
    // "conectado, porém sem template".
    waba: sessao?.wabaId ?? null,
    templates,
  });
}

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const r = await orgOrFail(requestId);
  if (!r.autorizado) return r.resposta;

  /**
   * A credencial vem do CANAL, e só cai no ambiente quando não há canal.
   *
   * Antes daqui saía `META_SYSTEM_USER_TOKEN` e nada mais: quem conectasse o
   * número pela TELA — que é como todo cliente conecta — recebia
   * `missing_meta_token` com o canal verde na tela. E uma variável de ambiente
   * é UMA: numa instalação com N clientes ela não tem como servir aos dois.
   *
   * ── Por que são DOIS desfechos, e não um ────────────────────────────────
   *
   * `credenciaisDaOrg` devolve `null` tanto para "não há canal oficial" quanto
   * para "há canal e nenhuma credencial responde". Colapsar os dois num
   * `no_meta_channel` manda o operador procurar o defeito no lugar errado: ele
   * vê o canal verde na tela e a API dizendo que não existe canal. Por isso a
   * sessão é consultada ANTES — só para separar as duas respostas —, e a
   * credencial continua saindo de `credenciaisDaOrg`.
   *
   * A pergunta aqui é "EXISTE canal oficial?" e não "a linha dele tem WABA?".
   * A segunda recusaria a instalação de número único que tem a WABA no
   * `META_WABA_ID` do ambiente e a coluna vazia — que funciona hoje, e para a
   * qual a resposta honesta é a do passo seguinte.
   */
  const sessao = await metaSessionForOrg(r.orgId);
  if (!sessao) {
    return fail("invalid_request", "no_meta_channel", 400, { requestId });
  }

  const creds = await credenciaisDaOrg(r.orgId);
  if (!creds) return fail("invalid_request", "missing_meta_token", 400, { requestId });

  try {
    const counts = await syncTemplates({
      organizationId: r.orgId,
      // `creds.wabaId` e não `sessao.wabaId`: as duas são a mesma WABA quando a
      // linha do canal a tem, mas só esta cai no `META_WABA_ID` do ambiente —
      // que é o que mantém de pé a instalação de número único de antes da tela.
      wabaId: creds.wabaId,
      token: creds.token,
      graphVersion: creds.graphVersion,
    });
    return ok(counts);
  } catch (err) {
    // A falha da Graph API vira mensagem legível na tela, não 500 mudo — o
    // operador precisa saber se é token vencido, WABA errada ou rede.
    return fail("internal_error", err instanceof Error ? err.message : "sync_failed", 502, {
      requestId,
    });
  }
}

/**
 * Salva o link da mídia de um modelo, para o painel da janela fechada
 * pré-preencher no próximo disparo. Valor vazio esquece o link.
 *
 * Só slot de mídia e só `https://` — ver `lib/channels/meta/valores-salvos.ts`.
 * Mesmo papel do sync (`admin`), e bloqueado em sessão de suporte, porque
 * escreve na configuração do canal.
 *
 * Grava em TODAS as linhas do mesmo nome e idioma da organização: a tela lista
 * o modelo uma vez só, e dois números oficiais com a mesma definição
 * divergiriam em silêncio se só um recebesse o link.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const r = await orgOrFail(requestId);
  if (!r.autorizado) return r.resposta;

  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    language?: unknown;
    values?: unknown;
  } | null;
  const valores = body?.values;
  if (
    typeof body?.name !== "string" ||
    typeof body?.language !== "string" ||
    !valores ||
    typeof valores !== "object" ||
    Array.isArray(valores) ||
    !Object.values(valores).every((v) => typeof v === "string")
  ) {
    return fail("validation_failed", "esperado { name, language, values: { chave: link } }", 422, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const { data: linhas, error } = await admin
    .from("meta_templates")
    .select("id, name, language, parameter_format, components, saved_values")
    .eq("organization_id", r.orgId)
    .eq("name", body.name)
    .eq("language", body.language);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!linhas || linhas.length === 0) {
    return fail("not_found", "modelo não encontrado", 404, { requestId });
  }

  // Confere TUDO antes de escrever qualquer linha: recusar a segunda depois de
  // gravar a primeira deixaria os números divergindo.
  const planos: Array<{ id: string; valores: Record<string, string> }> = [];
  for (const linha of linhas) {
    const contrato = deriveTemplateContract({
      name: linha.name,
      language: linha.language,
      parameter_format: linha.parameter_format,
      components: linha.components as never,
    });
    const m = mesclarValoresSalvos(
      contrato,
      (linha.saved_values ?? {}) as Record<string, unknown>,
      valores as Record<string, string>,
    );
    if (!m.ok) {
      return fail("validation_failed", m.motivo, 422, { requestId, details: { chave: m.chave } });
    }
    planos.push({ id: linha.id, valores: m.valores });
  }

  for (const plano of planos) {
    const { error: erro } = await admin
      .from("meta_templates")
      .update({ saved_values: plano.valores })
      .eq("organization_id", r.orgId)
      .eq("id", plano.id);
    if (erro) return fail("internal_error", erro.message, 500, { requestId });
  }

  return ok({ savedValues: planos[0]!.valores });
}
