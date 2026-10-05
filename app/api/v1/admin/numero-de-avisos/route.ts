/**
 * GET|PUT /api/v1/admin/numero-de-avisos — o número que avisa o TIME.
 *
 * É da PLATAFORMA, não do cliente: um só, conectado uma vez por quem opera e
 * adicionado aos grupos de todos. Exigir um número por cliente transformaria
 * cada implantação numa conexão a mais — e é encanamento nosso, não escolha de
 * quem comprou atendimento. Mesma doutrina de `lib/ai/custo-e-da-plataforma.ts`.
 *
 * ⚠️ Ponto único de falha assumido: se este número cair, NENHUM cliente recebe
 * aviso. O GET devolve `status` por isso — a tela precisa mostrar a saúde dele
 * com destaque, porque descobrir a queda pelo cliente reclamando é o desfecho
 * que a centralização compra se ninguém olhar. (O aviso automático já existe:
 * sendo uma sessão como as outras, ela entra no vigia de `channel-health`, e a
 * queda cai na Central da organização que a conectou — foi justamente por isso
 * que o número virou COLUNA numa sessão e não tabela própria.)
 *
 * O GET também lista os GRUPOS e as EMPRESAS: é do que a tela se alimenta para
 * o operador escolher, pelo NOME, qual grupo recebe o aviso de cada cliente em
 * vez de colar `120363…@g.us`.
 *
 * FORK MIA (.62): cada empresa pode mandar pelo número DELA
 * (`lib/avisos/origem-do-aviso.ts`). Por isso cada linha de empresa traz a
 * escolha, os números dela que podem ser escolhidos, a SITUAÇÃO de agora (por
 * onde o aviso está saindo, e por que não pelo escolhido) e os grupos do número
 * em uso — que, no modo empresa, são os do número dela e não os da plataforma.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { lerGrupoDeAvisos } from "@/lib/avisos/destino-do-aviso";
import { lerGruposDoNumero, type LeituraDosGrupos } from "@/lib/avisos/grupos-do-numero";
import {
  escolherNumeroDoAviso,
  lerOrigemDoAviso,
  type OrigemDoAviso,
} from "@/lib/avisos/origem-do-aviso";
import { getAdapter, PROVIDERS_QUE_ENTREGAM_EM_GRUPO } from "@/lib/channels";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  resolveSessionRef,
  type ChannelSessionRef,
} from "@/lib/channels/session-ref";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  /** A sessão que passa a ser a de avisos. `null` desmarca a atual. */
  channel_session_id: z.string().uuid().nullable(),
});

async function exigirPlataforma() {
  try {
    return await requirePlatformAdmin();
  } catch {
    // 403 e não 401: quem chega aqui está autenticado, só não é da plataforma.
    // Um número que fala com TODOS os clientes não é configuração de tenant.
    return null;
  }
}

/**
 * FORK MIA — a ESCRITA desta rota exige scope `full` e MFA em dia (upstream
 * 1.70, `requirePlatformAdminEscrita`): o acesso só de leitura ao painel de
 * plataforma (`support_readonly`) lê e não muda nada.
 */
async function exigirPlataformaParaEscrever(requestId: string) {
  try {
    return { ok: true as const, ctx: await requirePlatformAdminEscrita() };
  } catch (err) {
    return { ok: false as const, resposta: falhaDaEscritaDePlatformAdmin(err, requestId) };
  }
}

type LinhaDeSessao = ChannelSessionRef & {
  id: string;
  organization_id: string;
  phone_number: string | null;
  display_name: string | null;
  status: string | null;
  e_numero_de_avisos: boolean | null;
};

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await exigirPlataforma();
  if (!ctx) return fail("forbidden", "Platform admin required", 403, { requestId });

  const admin = createAdminClient();

  /**
   * Candidatas: toda sessão que entrega em grupo, de qualquer organização.
   *
   * Atravessa o tenant de propósito — é a única tela que pode. O número de
   * avisos é conectado como qualquer outro (QR, saúde, reconexão) dentro da
   * organização de quem opera, e aqui se diz qual dos números conectados tem
   * ESTE papel. Mostrar só os da org ativa esconderia justamente o número que
   * se está procurando quando o operador entra pelo painel da plataforma.
   */
  const { data: sessoes, error } = await admin
    .from("channel_sessions")
    .select(
      `id, organization_id, phone_number, display_name, status, e_numero_de_avisos, ${CHANNEL_SESSION_REF_COLUMNS}`,
    )
    .in("provider", PROVIDERS_QUE_ENTREGAM_EM_GRUPO)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) return fail("db_error", "Falha ao ler os canais.", 500, { requestId });

  const linhas = (sessoes ?? []) as unknown as LinhaDeSessao[];
  const marcada = linhas.find((s) => s.e_numero_de_avisos) ?? null;

  /**
   * A configuração do report INTERNO vem junto porque é a mesma tela: o mesmo
   * número, a mesma lista de grupos. Uma segunda chamada só para isto faria a
   * tela abrir com o grupo do report vazio por um instante — e "vazio" aqui
   * significa "desligado", que é uma mentira visível.
   */
  const { data: report } = await admin
    .from("platform_avisos")
    .select("grupo_id, grupo_nome, limite_saldo_usd, resumo_diario")
    .eq("id", 1)
    .maybeSingle();

  const { data: orgs } = await admin
    .from("organizations")
    .select("id, display_name, settings")
    .is("redacted_at", null)
    .order("display_name", { ascending: true });

  const base = (orgs ?? []).map(
    (o) => o as { id: string; display_name: string | null; settings: unknown },
  );
  const nomeDaOrg = new Map(base.map((e) => [e.id, e.display_name]));

  const resumoDaSessao = (s: LinhaDeSessao) => ({
    id: s.id,
    organization_id: s.organization_id,
    organizacao: nomeDaOrg.get(s.organization_id) ?? null,
    phone_number: s.phone_number,
    display_name: s.display_name,
    status: s.status,
  });

  /**
   * A lista de grupos vem do ADAPTER, e por presença do método: o painel não
   * pergunta QUAL canal é, pergunta se este canal sabe listar grupos. Canal que
   * não sabe devolve `undefined` aqui e a tela cai no mesmo caminho de
   * "não deu para perguntar", que é a verdade.
   */
  const adapter = marcada ? getAdapter(marcada.provider) : null;
  const leitura = marcada && adapter ? await lerGruposDoNumero(adapter, resolveSessionRef(marcada)) : null;
  const grupos = leitura?.ok ? leitura.grupos : null;

  /**
   * FORK MIA (.62) — cada empresa, com a escolha do número e o que ela VALE agora.
   *
   * A situação sai da MESMA função que decide o envio (`escolherNumeroDoAviso`):
   * a tela não tem uma opinião própria sobre para onde o aviso vai, ela mostra a
   * do motor. Duas respostas para a mesma pergunta divergiriam no dia em que uma
   * mudasse — e a tela diria "saindo pela empresa" com o aviso parado.
   *
   * Os grupos do número da empresa são lidos em paralelo, só para quem escolheu
   * o próprio número; o número caído nem é perguntado (a resposta seria erro, e
   * o motivo já se sabe).
   */
  const empresas = await Promise.all(
    base.map(async (linha) => {
      const origem: OrigemDoAviso = lerOrigemDoAviso(linha.settings);
      const grupo = lerGrupoDeAvisos(linha.settings);
      const idEscolhido = origem.modo === "empresa" ? origem.channel_session_id : null;
      const escolhida = idEscolhido
        ? (linhas.find((s) => s.id === idEscolhido && s.organization_id === linha.id) ?? null)
        : null;

      const numero = escolherNumeroDoAviso({
        organizationId: linha.id,
        origem,
        daEmpresa: escolhida,
        daPlataforma: marcada,
      });

      let gruposDoNumero: {
        grupos: Array<{ id: string; nome: string }>;
        indisponiveis: boolean;
        motivo: string | null;
      } | null = null;
      if (origem.modo === "empresa") {
        const lida: LeituraDosGrupos = !escolhida
          ? { ok: false, motivo: "sessao_inexistente" }
          : escolhida.status !== STATUS_SAUDAVEL
            ? { ok: false, motivo: "desconectado" }
            : await lerGruposDoNumero(getAdapter(escolhida.provider), resolveSessionRef(escolhida));
        gruposDoNumero = lida.ok
          ? { grupos: lida.grupos, indisponiveis: false, motivo: null }
          : { grupos: [], indisponiveis: true, motivo: lida.motivo };
      }

      return {
        id: linha.id,
        display_name: linha.display_name,
        grupo,
        origem,
        /**
         * Os números DESTA empresa que podem ser escolhidos: conectados agora
         * e que entregam em grupo (a lista de cima já só traz esses canais).
         * O número da plataforma fica de fora — escolhê-lo como "da empresa"
         * seria a opção "plataforma" com outro nome.
         */
        numeros: linhas
          .filter(
            (s) =>
              s.organization_id === linha.id &&
              s.status === STATUS_SAUDAVEL &&
              s.e_numero_de_avisos !== true,
          )
          .map(resumoDaSessao),
        /** O escolhido COMO ESTÁ (caído inclusive). `null` = modo plataforma, ou não existe mais. */
        numero_escolhido: escolhida ? resumoDaSessao(escolhida) : null,
        situacao: numero.ok
          ? { via: numero.via, motivo: numero.desvio, reserva: null }
          : { via: null, motivo: numero.motivo, reserva: numero.reserva },
        grupos_do_numero: gruposDoNumero,
        /**
         * Com a reserva ligada: o número da plataforma está no grupo escolhido?
         * A reserva manda pelo MESMO grupo, e o número da plataforma só consegue
         * falar num grupo de que participa. `null` = não deu para saber.
         */
        reserva_no_grupo:
          origem.modo === "empresa" && origem.reserva_da_plataforma && grupo && grupos
            ? grupos.some((g) => g.id === grupo.id)
            : null,
      };
    }),
  );

  return ok(
    {
      sessao: marcada ? resumoDaSessao(marcada) : null,
      candidatas: linhas.map(resumoDaSessao),
      /**
       * `null` = não deu para perguntar (canal fora do ar, sessão caída).
       * `[]`   = perguntou e o número não está em grupo nenhum.
       *
       * Juntar os dois faria a tela dizer "nenhum grupo" quando o problema é
       * que ninguém respondeu — e o operador iria adicionar o número a um grupo
       * onde ele já está.
       */
      grupos: grupos ?? [],
      grupos_indisponiveis: marcada !== null && grupos === null,
      /**
       * O PORQUÊ de `grupos_indisponiveis`, em código (a tela traduz em frase
       * e ação — `MotivoDaFalhaDeGrupos`). Sem ele a tela só
       * dizia "não consegui perguntar ao WhatsApp" e o seletor ficava travado
       * sem saída — foi o estado em produção em 29/09/2026.
       */
      grupos_motivo: leitura && !leitura.ok ? leitura.motivo : null,
      empresas,
      report: {
        grupo: (report as { grupo_id?: string | null; grupo_nome?: string | null } | null)?.grupo_id
          ? {
              id: (report as { grupo_id: string }).grupo_id,
              nome: (report as { grupo_nome?: string | null }).grupo_nome ?? "",
            }
          : null,
        limite_saldo_usd: Number(
          (report as { limite_saldo_usd?: unknown } | null)?.limite_saldo_usd ?? 20,
        ),
        resumo_diario: (report as { resumo_diario?: boolean } | null)?.resumo_diario !== false,
      },
    },
    { requestId },
  );
}

export async function PUT(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const escrita = await exigirPlataformaParaEscrever(requestId);
  if (!escrita.ok) return escrita.resposta;
  const ctx = escrita.ctx;

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Sessão inválida.", 422, { requestId });
  }

  const admin = createAdminClient();

  /**
   * Desmarca TODAS antes de marcar a nova.
   *
   * O índice único parcial do banco recusaria a segunda marcação, e o erro
   * seria um `23505` cru na tela. Limpar antes transforma "trocar o número de
   * avisos" no que o operador espera que seja: uma troca, e não um conflito.
   */
  await admin
    .from("channel_sessions")
    .update({ e_numero_de_avisos: false })
    .eq("e_numero_de_avisos", true);

  if (parsed.data.channel_session_id) {
    const { error } = await admin
      .from("channel_sessions")
      .update({ e_numero_de_avisos: true })
      .eq("id", parsed.data.channel_session_id)
      // Cinto: a tela só oferece canal que entrega em grupo, mas um PUT
      // montado à mão marcaria um número oficial e o aviso morreria num 4xx.
      .in("provider", PROVIDERS_QUE_ENTREGAM_EM_GRUPO);
    if (error) return fail("db_error", error.message, 500, { requestId });
  }

  void audit({
    action: "platform.numero_de_avisos_alterado",
    actorUserId: ctx.user.id,
    // Sem organização: o número é da PLATAFORMA, e carimbar o tenant ativo
    // faria a auditoria dizer que a Time Company mudou algo "dentro" de um
    // cliente qualquer que estivesse selecionado na hora.
    organizationId: null,
    requestId,
    metadata: { channel_session_id: parsed.data.channel_session_id },
  });

  return ok({ channel_session_id: parsed.data.channel_session_id }, { requestId });
}
